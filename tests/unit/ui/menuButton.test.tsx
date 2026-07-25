import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuButton } from '@/ui/MenuButton';

function renderMenu(onSelect: () => void = () => {}): void {
  render(
    <MenuButton
      label="Import"
      menuLabel="Import options"
      triggerClassName="btn"
      items={[
        { label: 'Music score (MXL)', onSelect },
        { label: 'Take file (JSON)', onSelect: () => {} },
      ]}
    />,
  );
}

describe('MenuButton', () => {
  afterEach(cleanup);

  it('toggles the panel and reports expansion on the trigger', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Import' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'Import options' })).toBeTruthy();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);

    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('runs onSelect while the panel is still mounted, then closes', () => {
    // The item must keep user activation, so onSelect may not wait on the
    // close: it has to run synchronously inside the click.
    const onSelect = vi.fn(() => {
      expect(screen.queryByRole('menu')).not.toBeNull();
    });
    renderMenu(onSelect);

    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Music score (MXL)' }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape and on a pointer press outside', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Import' });

    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('returns focus to the trigger when the panel it held focus in closes', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Import' });

    // Escape from an item: the focused element is about to be unmounted.
    fireEvent.click(trigger);
    screen.getByRole('menuitem', { name: 'Take file (JSON)' }).focus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);

    // Choosing an item closes it too.
    fireEvent.click(trigger);
    const item = screen.getByRole('menuitem', { name: 'Music score (MXL)' });
    item.focus();
    fireEvent.click(item);
    expect(document.activeElement).toBe(trigger);
  });

  it('leaves focus alone when the menu closes without holding it', () => {
    render(<button type="button">Elsewhere</button>);
    renderMenu();
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });

    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    elsewhere.focus();
    fireEvent.pointerDown(elsewhere);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(elsewhere);

    // Escape while focus sits outside must not yank it back either.
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    elsewhere.focus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.activeElement).toBe(elsewhere);
  });
});
