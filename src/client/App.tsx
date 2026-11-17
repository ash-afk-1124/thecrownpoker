import { Home } from './Home';
import { OnlineRoom } from './OnlineRoom';
import { SoloGame } from './SoloGame';
import { useRoute } from './router';

export function App() {
  const route = useRoute();
  if (route.name === 'solo') return <SoloGame />;
  if (route.name === 'room') return <OnlineRoom key={route.code} code={route.code} />;
  return <Home />;
}
