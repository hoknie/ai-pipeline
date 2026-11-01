// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../src/ui/collapsible.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../src/ui/select.tsx';
import { Switch } from '../src/ui/switch.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../src/ui/tabs.tsx';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../src/ui/alert-dialog.tsx';

import { choose, cleanup, fireEvent, render, screen, waitFor } from './render.tsx';

afterEach(() => cleanup());

describe('tabs', () => {
  it('switch with the arrow keys', async () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">First</TabsTrigger>
          <TabsTrigger value="b">Second</TabsTrigger>
        </TabsList>
        <TabsContent value="a">text a</TabsContent>
        <TabsContent value="b">text b</TabsContent>
      </Tabs>,
    );
    const first = screen.getByRole('tab', { name: 'First' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Second' }).getAttribute('aria-selected')).toBe(
        'true',
      ),
    );
    expect(screen.getByText('text b')).toBeTruthy();
    expect(screen.queryByText('text a')).toBeNull();
  });
});

describe('alert dialog', () => {
  const dialog = () => (
    <AlertDialog>
      <AlertDialogTrigger>Delete</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>Sure?</AlertDialogTitle>
        <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction>Yes</AlertDialogAction>
      </AlertDialogContent>
    </AlertDialog>
  );

  it('puts the focus on the refusal and closes on Esc', async () => {
    render(dialog());
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });
});

describe('collapsible', () => {
  it('toggles aria-expanded on its trigger', () => {
    render(
      <Collapsible>
        <CollapsibleTrigger>Attempt</CollapsibleTrigger>
        <CollapsibleContent>body</CollapsibleContent>
      </Collapsible>,
    );
    const trigger = screen.getByRole('button', { name: 'Attempt' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('body')).toBeNull();
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('body')).toBeTruthy();
  });
});

describe('select', () => {
  function Pick() {
    const [value, setValue] = useState('claude');
    return (
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger aria-label="Runtime">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="claude">claude</SelectItem>
          <SelectItem value="opencode">opencode</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  it('opens by the combobox role and picks an option by the option role', async () => {
    render(<Pick />);
    const trigger = screen.getByRole('combobox', { name: 'Runtime' });
    expect(trigger.textContent).toBe('claude');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(await screen.findAllByRole('option')).toHaveLength(2);
    choose(trigger, 'opencode');
    await waitFor(() => expect(trigger.textContent).toBe('opencode'));
  });
});

describe('switch', () => {
  it('toggles on click', () => {
    render(<Switch aria-label="toggle" />);
    const sw = screen.getByRole('switch', { name: 'toggle' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.getAttribute('data-state')).toBe('checked');
    fireEvent.click(sw);
    expect(sw.getAttribute('data-state')).toBe('unchecked');
  });

  it('keeps the thumb inside the track with equal padding', () => {
    render(<Switch aria-label="toggle" />);
    const track = screen.getByRole('switch');
    const thumb = track.firstElementChild as HTMLElement;
    const all = `${track.className} ${thumb.className}`;
    expect(all).not.toMatch(/\d+px/);
    const step = (cls: string, prefix: string) => {
      const m = cls.split(/\s+/).find((c) => new RegExp(`^${prefix}-\\d+(\\.\\d+)?$`).test(c));
      expect(m).toBeTruthy();
      return Number(m!.slice(prefix.length + 1));
    };
    const h = step(track.className, 'h');
    const w = step(track.className, 'w');
    const p = step(track.className, 'p');
    const size = step(thumb.className, 'size');
    expect(h - 2 * p).toBe(size);
    expect(w - 2 * p - size).toBe(size);
    expect(thumb.className).toContain('data-[state=checked]:translate-x-full');
    expect(thumb.className).toContain('data-[state=unchecked]:translate-x-0');
  });
});
