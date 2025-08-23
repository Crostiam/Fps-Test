export class Input {
  constructor() {
    this.forward = false;
    this.back = false;
    this.left = false;
    this.right = false;
    this.jump = false;
    this.sprint = false;
    this.interact = false;

    window.addEventListener('keydown', (e) => this._onKey(e, true));
    window.addEventListener('keyup', (e) => this._onKey(e, false));
  }

  _onKey(e, down) {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': this.forward = down; break;
      case 'KeyS': case 'ArrowDown': this.back = down; break;
      case 'KeyA': case 'ArrowLeft': this.left = down; break;
      case 'KeyD': case 'ArrowRight': this.right = down; break;
      case 'Space': this.jump = down; break;
      case 'ShiftLeft': case 'ShiftRight': this.sprint = down; break;
      case 'KeyE': this.interact = down; break;
    }
  }
}
