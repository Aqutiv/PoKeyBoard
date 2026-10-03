import { en } from '@/i18n/en';
import { es } from '@/i18n/es';
import { fr } from '@/i18n/fr';
import { mg } from '@/i18n/mg';
import type { Messages, SupportedLanguage } from '@/i18n/types';

/** Every catalog at once, for tests; the app fetches all but English on first use. */
export const catalogs: Record<SupportedLanguage, Messages> = { en, es, fr, mg };
