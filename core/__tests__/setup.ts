declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function scrollTo(this: HTMLElement, optionsOrX?: ScrollToOptions | number, y?: number) {
  const nextLeft =
    typeof optionsOrX === 'number' ? optionsOrX : (optionsOrX?.left ?? this.scrollLeft);
  const nextTop =
    typeof optionsOrX === 'number' ? (y ?? this.scrollTop) : (optionsOrX?.top ?? this.scrollTop);

  this.scrollLeft = nextLeft;
  this.scrollTop = nextTop;
}

if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.scrollTo) {
  HTMLElement.prototype.scrollTo = scrollTo;
}
