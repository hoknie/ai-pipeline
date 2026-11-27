import { expect, test } from '@playwright/test';

test('the toolbar opens a link dialog before the body has ever received focus', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('textbox', { name: 'Link text' }).fill('guide');
  await page.getByRole('textbox', { name: 'Link destination' }).fill('docs/guide.md');
  await page.getByRole('button', { name: 'Apply link' }).click();
  await expect(page.getByRole('textbox', { name: 'Body' })).toBeFocused();
  await expect(page.locator('[data-testid="draft"]')).toHaveText('[guide](docs/guide.md)');
});

test('locked source and visual descriptions receive focus without allowing edits', async ({
  page,
}) => {
  await page.goto('/?locked');
  const body = page.getByRole('textbox', { name: 'Body' });
  const toggle = page.getByRole('button', { name: 'Markdown source' });
  await toggle.click();
  await expect(body).toBeFocused();
  await expect(body).toHaveAttribute('readonly', '');
  await toggle.click();
  await expect(body).toBeFocused();
  await expect(body).toHaveAttribute('contenteditable', 'false');
  await body.press('x');
  await expect(page.locator('[data-testid="draft"]')).toBeEmpty();
});

test('Enter activates Cancel and Remove link rather than applying the dialog', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Markdown source' }).click();
  await page.getByRole('textbox', { name: 'Body' }).fill('[guide](docs/guide.md)');
  await page.getByRole('button', { name: 'Markdown source' }).click();
  const editor = page.getByRole('textbox', { name: 'Body' });
  await editor.click();
  await editor.press('Home');
  await editor.press('ArrowRight');
  await editor.press('Control+k');
  await page.getByRole('textbox', { name: 'Link destination' }).fill('changed.md');
  await page.getByRole('button', { name: 'Cancel', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-testid="draft"]')).toHaveText('[guide](docs/guide.md)');
  await editor.press('Control+k');
  await page.getByRole('button', { name: 'Remove link' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-testid="draft"]')).toHaveText('guide');
  await editor.press('Control+z');
  await expect(page.locator('[data-testid="draft"]')).toHaveText('[guide](docs/guide.md)');
});

test('the real code NodeView colors JSON attributes/literals and language keywords', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Markdown source' }).click();
  await page
    .getByRole('textbox', { name: 'Body' })
    .fill('```json\n{"ready":true}\n```\n\n```js\nconst ready = true;\n```');
  await page.getByRole('button', { name: 'Markdown source' }).click();
  for (const token of ['.hljs-attr', '.hljs-literal', '.hljs-keyword']) {
    const element = page.locator(`pre ${token}`).first();
    await expect(element).toBeVisible();
    expect(await element.evaluate((node) => getComputedStyle(node).color)).not.toBe(
      await element.evaluate((node) => getComputedStyle(node.closest('pre')!).color),
    );
  }
});
