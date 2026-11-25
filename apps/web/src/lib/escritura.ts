/** Emisión de "está escribiendo": con límite de frecuencia y apagado por inactividad. */
export class CanalEscritura {
  private ultimo = -Infinity;
  private activo = false;
  private temporizador: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly emitir: (escribiendo: boolean) => void,
    private readonly cadaMs = 2000,
    private readonly inactividadMs = 3000,
    private readonly ahora: () => number = Date.now,
  ) {}

  teclear() {
    const t = this.ahora();
    if (!this.activo || t - this.ultimo >= this.cadaMs) {
      this.activo = true;
      this.ultimo = t;
      this.emitir(true);
    }
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.detener(), this.inactividadMs);
  }

  detener() {
    clearTimeout(this.temporizador);
    if (!this.activo) return;
    this.activo = false;
    this.emitir(false);
  }
}
