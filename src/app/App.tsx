import { lazy, Suspense } from 'react';
import { useExportUiStore } from '@/state/useExportUiStore';
import { AppNav } from './AppNav';
import { AppProviders } from './providers';
import { useRouter } from './routerContext';

const AboutPage = lazy(() =>
  import('@/features/about/AboutPage').then((module) => ({ default: module.AboutPage })),
);
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
const LibraryPage = lazy(() =>
  import('@/features/library/LibraryPage').then((module) => ({ default: module.LibraryPage })),
);
const PlayPage = lazy(() =>
  import('@/features/play/PlayPage').then((module) => ({ default: module.PlayPage })),
);
const SettingsPage = lazy(() =>
  import('@/features/settings/SettingsPage').then((module) => ({ default: module.SettingsPage })),
);
const TakesPage = lazy(() =>
  import('@/features/takes/TakesPage').then((module) => ({ default: module.TakesPage })),
);

function CurrentView() {
  const { route } = useRouter();
  switch (route) {
    case 'play':
      return <PlayPage />;
    case 'library':
      return <LibraryPage />;
    case 'takes':
      return <TakesPage />;
    case 'settings':
      return <SettingsPage />;
    case 'about':
      return <AboutPage />;
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
  return (
    <div className="app-shell">
      <div className="app-shell__content">
        <Suspense fallback={<div className="app-boot">Loading…</div>}>
          <CurrentView />
        </Suspense>
      </div>
      <AppNav />
      <ExportDialogs />
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
