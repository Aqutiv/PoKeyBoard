import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { gotoAppReady, nav, openSettings, persistedSetting } from './helpers';

/**
 * A Bluetooth MIDI keyboard for the page: Web Bluetooth's device chooser
 * cannot be driven from Playwright, so `navigator.bluetooth` is replaced
 * before the app loads by one that "picks" a PartyKeys at once and lets the
 * test send its notifications (`__fakeBle.notify`) and read what the app
 * writes back (`__fakeBle.writes`). Web MIDI is stubbed to an empty, granted
 * access, so a USB keyboard on the machine running the suite stays out of it.
 */
async function installFakeKeyboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class Characteristic extends EventTarget {
      value: DataView | null = null;
      properties = { writeWithoutResponse: true };
      async readValue() {
        return new DataView(new ArrayBuffer(0));
      }
      async startNotifications() {
        return this;
      }
      async writeValueWithoutResponse(value: Uint8Array) {
        fake.writes.push([...value]);
      }
      async writeValueWithResponse(value: Uint8Array) {
        fake.writes.push([...value]);
      }
    }
    const characteristic = new Characteristic();
    const device = Object.assign(new EventTarget(), {
      id: 'fake-partykeys',
      name: 'PartyKeys',
      gatt: {
        connected: false,
        async connect() {
          device.gatt.connected = true;
          return {
            async getPrimaryService() {
              return {
                async getCharacteristic() {
                  return characteristic;
                },
              };
            },
          };
        },
        disconnect() {
          if (!device.gatt.connected) return;
          device.gatt.connected = false;
          device.dispatchEvent(new Event('gattserverdisconnected'));
        },
      },
    });
    const fake = {
      writes: [] as number[][],
      chooserOpened: 0,
      notify(bytes: number[]) {
        characteristic.value = new DataView(Uint8Array.from(bytes).buffer);
        characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
      },
    };
    Object.defineProperty(window, '__fakeBle', { value: fake });
    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true,
      value: {
        async getAvailability() {
          return true;
        },
        async requestDevice() {
          fake.chooserOpened += 1;
          return device;
        },
        async getDevices() {
          return [device];
        },
      },
    });

    const access = Object.assign(new EventTarget(), { inputs: new Map(), outputs: new Map() });
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: async () => access,
    });
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = ((descriptor: PermissionDescriptor) =>
      (descriptor.name as string) === 'midi'
        ? Promise.resolve({ state: 'granted' } as PermissionStatus)
        : query(descriptor)) as typeof navigator.permissions.query;
  });
}

/** One BLE-MIDI packet: header, timestamp, then the message. */
function packet(...message: number[]): number[] {
  return [0x80, 0x80, ...message];
}

async function send(page: Page, bytes: number[]): Promise<void> {
  await page.evaluate((data) => {
    (window as unknown as { __fakeBle: { notify(bytes: number[]): void } }).__fakeBle.notify(data);
  }, bytes);
}

function chooserOpened(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __fakeBle: { chooserOpened: number } }).__fakeBle.chooserOpened,
  );
}

test.describe('Bluetooth MIDI keyboard', () => {
  test('connects from Settings, plays the piano, and comes back on reload', async ({ page }) => {
    await installFakeKeyboard(page);
    await gotoAppReady(page);

    await openSettings(page, 'Playing');
    await page.getByRole('checkbox', { name: 'Play with a MIDI keyboard' }).check();
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByText('Connected over Bluetooth: PartyKeys')).toBeVisible();
    await expect
      .poll(() => persistedSetting(page, 'bluetoothMidiDevice'))
      .toEqual({ id: 'fake-partykeys', name: 'PartyKeys' });

    // Its keys play the piano, on the Play page's keys too.
    await nav(page).getByRole('button', { name: 'Play' }).click();
    const c4 = page.getByRole('button', { name: 'C4 key' });
    await send(page, packet(0x90, 60, 100));
    await expect(c4).toHaveAttribute('aria-pressed', 'true');
    await send(page, packet(0x80, 60, 0));
    await expect(c4).toHaveAttribute('aria-pressed', 'false');

    // A later visit reconnects without the chooser.
    await page.reload();
    await page.locator('section[data-piano-ready="true"]').waitFor({ timeout: 30_000 });
    await send(page, packet(0x90, 62, 90));
    await expect(page.getByRole('button', { name: 'D4 key' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await chooserOpened(page)).toBe(0);

    // Disconnect forgets it.
    await openSettings(page, 'Playing');
    await expect(page.getByText('Connected over Bluetooth: PartyKeys')).toBeVisible();
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByText('No Bluetooth keyboard connected.')).toBeVisible();
    await expect.poll(() => persistedSetting(page, 'bluetoothMidiDevice')).toBeNull();
  });
});
