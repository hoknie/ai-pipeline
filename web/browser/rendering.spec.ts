import { expect, test, type Page } from '@playwright/test';

async function setSource(page: Page, source: string) {
  await page.getByRole('button', { name: 'Markdown source' }).click();
  await page.getByRole('textbox', { name: 'Body' }).fill(source);
  await page.getByRole('button', { name: 'Markdown source' }).click();
}

const diagrams = [
  ['mermaid', 'graph TD\n A[Private start] --> B[Private end]'],
  ['mermaid', 'sequenceDiagram\n Alice->>Bob: Private hello'],
  ['mermaid', 'classDiagram\n Animal <|-- Duck'],
  ['mermaid', 'stateDiagram-v2\n [*] --> Open\n Open --> Closed'],
  ['mermaid', 'erDiagram\n CUSTOMER ||--o{ ORDER : places'],
  ['plantuml', '@startuml\nAlice -> Bob : Private hello\n@enduml'],
  ['plantuml', '@startuml\nclass Animal {\n +eat()\n}\nclass Duck\nAnimal <|-- Duck\n@enduml'],
] as const;

test('real engines, canvas and Wasm render offline and keep every fence unchanged', async ({
  page,
  context,
}) => {
  const requests: string[] = [];
  context.on('request', (request) => requests.push(`${request.method()} ${request.url()}`));
  await page.goto('/');
  const source = diagrams
    .map(([language, code]) => `\`\`\`${language}\n${code}\n\`\`\``)
    .join('\n\n');
  await setSource(page, source);
  await expect(page.getByRole('textbox', { name: 'Body' }).locator('svg')).toHaveCount(
    diagrams.length,
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('svg text').filter({ hasText: 'Private hello' })).toHaveCount(2);
  await expect(page.locator('svg text').filter({ hasText: 'eat()' })).toHaveCount(1);
  await expect(page.locator('[data-testid="draft"]')).toHaveText(source);
  // No route mocks: Chromium must reuse the real, cacheable worker bundle while offline.
  await setSource(page, '');
  await context.setOffline(true);
  await setSource(page, source);
  await expect(page.getByRole('textbox', { name: 'Body' }).locator('svg')).toHaveCount(
    diagrams.length,
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('[data-testid="draft"]')).toHaveText(source);
  expect(requests.every((url) => url.startsWith('GET http://127.0.0.1:4178/'))).toBe(true);
  expect(requests.some((url) => /Private|Alice|Animal|hello/.test(url))).toBe(false);
});

test('syntax errors and resource directives keep safe, editable source', async ({ page }) => {
  await page.goto('/');
  const cases = [
    ['mermaid', 'not a diagram !!!'],
    ['plantuml', '@startuml\nthis is not a diagram !!!\n@enduml'],
    ['mermaid', '%%{init: {securityLevel: loose}}%%\ngraph TD\nA-->B'],
    ['plantuml', '@startuml\n!include http://127.0.0.1:4178/private-diagram-marker\n@enduml'],
  ];
  for (const [language, code] of cases) {
    const source = `\`\`\`${language}\n${code}\n\`\`\``;
    await setSource(page, source);
    await expect(page.getByRole('alert')).toHaveCount(1);
    await expect(page.locator('pre code')).toHaveText(code!);
    await expect(page.getByRole('textbox', { name: 'Body' }).locator('svg')).toHaveCount(0);
    await expect(page.locator('[data-testid="draft"]')).toHaveText(source);
  }
});

test('source HTML and malicious diagram labels never become executable or external DOM', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/');
  const source = [
    '<img src="/private-diagram-marker" onerror="window.pwned=1">',
    '```mermaid\ngraph TD\nA["<script>window.pwned=1</script>"] --> B[Safe]\n```',
    '```plantuml\n@startuml\nAlice -> Bob : <img:http://127.0.0.1:4178/private-diagram-marker>\n@enduml\n```',
    '```plantuml\n@startuml\nAlice -> Bob : [[http://127.0.0.1:4178/private-diagram-marker link]]\n@enduml\n```',
  ].join('\n\n');
  await setSource(page, source);
  await expect(page.getByRole('alert')).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: 'Body' }).locator('svg')).toHaveCount(2);
  await expect(page.locator('svg script,svg image,svg foreignObject,svg a,[onerror]')).toHaveCount(
    0,
  );
  expect(await page.evaluate(() => 'pwned' in window)).toBe(false);
  expect(requests.some((url) => url.includes('private-diagram-marker'))).toBe(false);
  await expect(page.locator('[data-testid="draft"]')).toHaveText(source);
});
