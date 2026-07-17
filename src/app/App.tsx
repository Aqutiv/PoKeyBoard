import { AboutPage } from '@/features/about/AboutPage';
import { PlayPage } from '@/features/play/PlayPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { TakesPage } from '@/features/takes/TakesPage';
import { AppNav } from './AppNav';
import { AppProviders } from './providers';
import { useRouter } from './routerContext';

function CurrentView() {
  const { route } = useRouter();
  switch (route) {
    case 'play':
      return <PlayPage />;
    case 'takes':
      return <TakesPage />;
    case 'settings':
      return <SettingsPage />;
    case 'about':
      return <AboutPage />;
  }
}

function Shell() {
  return (
    <div className="app-shell">
      <div className="app-shell__content">
        <CurrentView />
      </div>
      <AppNav />
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
