import { fireEvent, screen } from './render.tsx';

/** Opens the picker of a model field, types the value and takes the listed model or «use typed». */
export async function chooseModel(value: string, label = 'Model'): Promise<void> {
  fireEvent.click(await screen.findByRole('combobox', { name: label }));
  const search = await screen.findByRole('combobox', { name: `Search in ${label}` });
  fireEvent.change(search, { target: { value } });
  const options = await screen.findAllByRole('option');
  const exact = options.find((option) => option.textContent === value);
  const typed = options.find((option) => option.textContent === `Use «${value}»`);
  fireEvent.click((exact ?? typed)!);
}

/** The model a picker holds, as it would be saved. */
export function modelValue(label = 'Model'): string {
  return screen.getByRole('combobox', { name: label }).getAttribute('data-value') ?? '';
}

/** The models of every picker on the page, in order; fields without a picker are skipped. */
export function modelValues(): string[] {
  return screen
    .getAllByRole('combobox')
    .map((element) => element.getAttribute('data-value'))
    .filter((value): value is string => value !== null);
}
