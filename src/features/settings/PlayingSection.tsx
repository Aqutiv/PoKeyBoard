import { TOUCH_SENSITIVITIES, type TouchSensitivity } from '@/features/keyboard/velocityResponse';
import { useMessages } from '@/i18n/i18nContext';
import { useSettingsStore, type VelocityMode } from '@/state/useSettingsStore';
import { ChoiceSwitch } from './ChoiceSwitch';
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
        <ChoiceSwitch<VelocityMode>
          label={m.settings.velocity}
          value={settings.velocityMode}
          options={[
            { value: 'touch', label: m.settings.velocityTouch },
            { value: 'fixed', label: m.settings.velocityFixed },
          ]}
          onChange={settings.setVelocityMode}
        />
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
            <ChoiceSwitch
              label={m.settings.touchSensitivity}
              value={settings.touchSensitivity}
              options={TOUCH_SENSITIVITIES.map((sensitivity) => ({
                value: sensitivity,
                label: m.settings[TOUCH_SENSITIVITY_LABELS[sensitivity]],
              }))}
              onChange={settings.setTouchSensitivity}
            />
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
