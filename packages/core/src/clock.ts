export interface Clock {
  now(): Date;
}

export function fixedClock(iso: string): Clock & { advance(ms: number): void } {
  let current = new Date(iso).getTime();
  if (Number.isNaN(current)) throw new RangeError(`Invalid ISO time: ${iso}`);
  return {
    now: () => new Date(current),
    advance(ms: number) {
      current += ms;
    },
  };
}
