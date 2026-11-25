import { createRoot } from 'react-dom/client';
import { NOMBRE_SISTEMA } from '@eco/shared/marca';

createRoot(document.getElementById('root')!).render(<h1>{NOMBRE_SISTEMA}</h1>);
