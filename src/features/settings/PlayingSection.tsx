import { TOUCH_SENSITIVITIES, type TouchSensitivity } from '@/features/keyboard/velocityResponse';
import { useMessages } from '@/i18n/i18nContext';
import { useSettingsStore } from '@/state/useSettingsStore';
import { MidiSection } from './MidiSection';
import { SettingsGroup } from './SettingsGroup';

const TOUCH_SENSITIVITY_LABELS: Record<
  TouchSensitivity,
  'touchSensitivityLight' | 'touchSensitivityNormal' | 'touchSensitivityFirm'
> = {
  light: 'touchSensitivityLight',
  normal: 'touchSensitivityNormal',
  firm: 'touchSensitivityFirm',
};

/** Settings → Playing: how a touch becomes a note, and what else can play. */
export function PlayingSection() {
  const m = useMessages();
  const settings = useSettingsStore();

  return (
    <>
      <SettingsGroup id="touch" heading={m.settings.touch}>
        <div
          className="setting-row setting-row--stack"
          role="radiogroup"
          aria-label={m.settings.velocity}
        >
          <span>{m.settings.velocity}</span>
          <label>
            <input
              type="radio"
              name="velocity-mode"
              checked={settings.velocityMode === 'touch'}
              onChange={() => settings.setVelocityMode('touch')}
            />
            {m.settings.velocityTouch}
          </label>
          <label>
            <input
              type="radio"
              name="velocity-mode"
              checked={settings.velocityMode === 'fixed'}
              onChange={() => settings.setVelocityMode('fixed')}
            />
            {m.settings.velocityFixed}
          </label>
        </div>
        {settings.velocityMode === 'fixed' ? (
          <label className="setting-row">
            <span>{m.settings.fixedVelocity}</span>
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={settings.fixedVelocity}
              onChange={(e) => settings.setFixedVelocity(Number(e.target.value))}
            />
          </label>
        ) : (
          <>
            <div
              className="setting-row setting-row--stack"
              role="radiogroup"
              aria-label={m.settings.touchSensitivity}
            >
              <span>{m.settings.touchSensitivity}</span>
              {TOUCH_SENSITIVITIES.map((sensitivity) => (
                <label key={sensitivity}>
                  <input
                    type="radio"
                    name="touch-sensitivity"
                    checked={settings.touchSensitivity === sensitivity}
                    onChange={() => settings.setTouchSensitivity(sensitivity)}
                  />
                  {m.settings[TOUCH_SENSITIVITY_LABELS[sensitivity]]}
                </label>
              ))}
            </div>
            <p className="settings__hint">{m.settings.touchSensitivityHint}</p>
          </>
        )}
        {/* Under both modes: the computer keyboard plays the fixed velocity
            in either, and the app explains that keyboard nowhere else. */}
        <p className="settings__hint">{m.settings.accentHint}</p>
      </SettingsGroup>

      <SettingsGroup id="controllers" heading={m.settings.controllers}>
        <MidiSection />
        <label className="setting-row">
          <span>{m.settings.gamepad}</span>
          <input
            type="checkbox"
            checked={settings.gamepadInput}
            onChange={(e) => settings.setGamepadInput(e.target.checked)}
          />
        </label>
        <p className="settings__hint">{m.settings.gamepadHint}</p>
      </SettingsGroup>
    </>
  );
}
