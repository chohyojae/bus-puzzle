import type { Settings } from '../../storage/save-schema';

let context: AudioContext | undefined;
export function feedback(settings: Settings, success: boolean) {
  if (settings.hapticsEnabled && typeof navigator.vibrate === 'function')
    navigator.vibrate(success ? 12 : [15, 30, 15]);
  if (!settings.soundEnabled) return;
  try {
    context ??= new AudioContext();
    void context
      .resume()
      .then(() => {
        if (context?.state !== 'running') return;
        const oscillator = context.createOscillator(),
          gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = success ? 620 : 180;
        gain.gain.setValueAtTime(0.055, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.09);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.1);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
      })
      .catch(() => undefined);
  } catch {
    /* Browsers without Web Audio can still play the game. */
  }
}
