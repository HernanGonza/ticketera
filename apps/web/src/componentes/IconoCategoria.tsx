import {
  AppWindow,
  Cctv,
  CircleHelp,
  Database,
  Globe,
  HardDrive,
  Keyboard,
  Laptop,
  Mail,
  MonitorX,
  Network,
  PackagePlus,
  Phone,
  Printer,
  Projector,
  Server,
  Shield,
  UserCog,
  Wifi,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { ICONOS_CATEGORIA } from '@eco/shared/schemas';

export type NombreIcono = (typeof ICONOS_CATEGORIA)[number];

/** El tipo obliga a cubrir exactamente la lista compartida. */
export const ICONOS: Record<NombreIcono, LucideIcon> = {
  network: Network,
  wifi: Wifi,
  'monitor-x': MonitorX,
  printer: Printer,
  mail: Mail,
  'user-cog': UserCog,
  'app-window': AppWindow,
  phone: Phone,
  'package-plus': PackagePlus,
  projector: Projector,
  cctv: Cctv,
  'circle-help': CircleHelp,
  laptop: Laptop,
  'hard-drive': HardDrive,
  keyboard: Keyboard,
  server: Server,
  shield: Shield,
  database: Database,
  globe: Globe,
  wrench: Wrench,
};

export function IconoCategoria({ nombre, className }: { nombre: string; className?: string }) {
  const I = ICONOS[nombre as NombreIcono] ?? CircleHelp;
  return <I aria-hidden className={className} />;
}
