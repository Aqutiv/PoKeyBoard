import { lazy, Suspense } from 'react';
import { useMidiInput } from '@/features/keyboard/useMidiInput';
import { useExportUiStore } from '@/state/useExportUiStore';
import { ImportDialogs } from './ImportDialogs';
import { NowPlaying } from './NowPlaying';
import { AppNav } from './AppNav';
import { AppProviders } from './providers';
import { loadOnce } from '@/utils/loadOnce';
import { parseHash, useRouter, type Route } from './routerContext';

const PAGES = {
  about: loadOnce(() =>
    import('@/features/about/AboutPage').then((module) => ({ default: module.AboutPage })),
  ),
  learn: loadOnce(() =>
    import('@/features/learn/LearnPage').then((module) => ({ default: module.LearnPage })),
  ),
  library: loadOnce(() =>
    import('@/features/library/LibraryPage').then((module) => ({ default: module.LibraryPage })),
  ),
  play: loadOnce(() =>
    import('@/features/play/PlayPage').then((module) => ({ default: module.PlayPage })),
  ),
  settings: loadOnce(() =>
    import('@/features/settings/SettingsPage').then((module) => ({
      default: module.SettingsPage,
    })),
  ),
  takes: loadOnce(() =>
    import('@/features/takes/TakesPage').then((module) => ({ default: module.TakesPage })),
  ),
} satisfies Record<Route, unknown>;

// The page the app opens on is fetched now, alongside the startup reads,
// rather than once they are done: on a slow machine or connection, that is one
// wait instead of two. Its lazy() below picks up the same download.
PAGES[parseHash()]().catch(() => undefined);

const AboutPage = lazy(PAGES.about);
const AudioExportDialog = lazy(() =>
  import('@/features/export/AudioExportDialog').then((module) => ({
    default: module.AudioExportDialog,
  })),
);
const SheetExportDialog = lazy(() =>
  import('@/features/export/SheetExportDialog').then((module) => ({
    default: module.SheetExportDialog,
  })),
);
const LearnPage = lazy(PAGES.learn);
const LibraryPage = lazy(PAGES.library);
const PlayPage = lazy(PAGES.play);
const SettingsPage = lazy(PAGES.settings);
const TakesPage = lazy(PAGES.takes);

function CurrentView() {
  const { route } = useRouter();
  switch (route) {
    case 'play':
      return <PlayPage />;
    case 'learn':
      return <LearnPage />;
    case 'library':
      return <LibraryPage />;
    case 'takes':
      return <TakesPage />;
    case 'settings':
      return <SettingsPage />;
    case 'about':
      return <AboutPage />;
    default: {
      // `noImplicitReturns` is off, so a Route with no case here would render
      // a blank page rather than fail the build. This makes it fail the build.
      const unhandled: never = route;
      return unhandled;
    }
  }
}

function ExportDialogs() {
  const audioRequested = useExportUiStore((state) => state.requestedTakeId !== null);
  const sheetRequested = useExportUiStore((state) => state.sheetRequestedTakeId !== null);
  return (
    <Suspense fallback={null}>
      {audioRequested ? <AudioExportDialog /> : null}
      {sheetRequested ? <SheetExportDialog /> : null}
    </Suspense>
  );
}

function Shell() {
  // Lives here rather than with the key bed so a connected MIDI keyboard keeps
  // playing on every tab, not just Play.
  useMidiInput();
  return (
    <div className="app-shell">
      <div className="app-shell__content">
        <div className="app-shell__viewport">
          <Suspense fallback={<div className="app-boot">Loading…</div>}>
            <CurrentView />
          </Suspense>
        </div>
        <NowPlaying />
      </div>
      <AppNav />
      <ExportDialogs />
      <ImportDialogs />
    </div>
  );
}

export default function App() {
  return (
    <AppProviders>
      <Shell />
    </AppProviders>
  );
}
