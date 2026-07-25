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
});
