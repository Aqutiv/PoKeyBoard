import type { ReactNode } from 'react';

/**
 * One headed group within a Settings section. Its heading sticks to the top of
 * the scroller while the group's rows pass beneath it, as Learn's part headings
 * and the library's composer headings do.
 */
export function SettingsGroup({
  id,
  heading,
  children,
}: {
  id: string;
  heading: string;
  children: ReactNode;
}) {
  const headingId = `settings-group-${id}`;
  return (
    <section className="settings-group" aria-labelledby={headingId}>
      <h2 className="settings-group__heading" id={headingId}>
        {heading}
      </h2>
      {children}
    </section>
  );
}
