export class Input {
  constructor() {
    this.keys = new Set();
    this.pointerLocked = false;

    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = !!document.pointerLockElement;
    });
  }

  get forward() { return this.keys.has('KeyW') || this.keys.has('ArrowUp'); }
  get back() { return this.keys.has('KeyS') || this.keys.has('ArrowDown'); }
  get left() { return this.keys.has('KeyA') || this.keys.has('ArrowLeft'); }
  get right() { return this.keys.has('KeyD') || this.keys.has('ArrowRight'); }
  get jump() { return this.keys.has('Space'); }
  get sprint() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'); }
}
