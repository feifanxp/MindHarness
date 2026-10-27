import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { afterEach, describe, expect, it } from 'vitest';
import { syncDayjsLocale } from './appLocale';

dayjs.extend(relativeTime);

describe('syncDayjsLocale', () => {
  afterEach(() => {
    dayjs.locale('en');
  });

  it.each([
    ['de-AT', 'de', 'Februar', 'in 2 Tagen'],
    ['nl-BE', 'nl', 'februari', 'over 2 dagen'],
    ['es-MX', 'es', 'febrero', 'en 2 días'],
    ['fr-CA', 'fr', 'février', 'dans 2 jours'],
    ['pt-BR', 'pt', 'fevereiro', 'em 2 dias'],
    ['it-IT', 'it', 'febbraio', 'tra 2 giorni'],
    ['zh-CN', 'zh', '二月', '2 天后'],
    ['zh-Hant-HK', 'zh-TW', '二月', '2 天內'],
    ['ja-JP', 'ja', '2月', '2日後'],
    ['ko-KR', 'ko', '2월', '2일 후'],
    ['hi-IN', 'hi', 'फ़रवरी', '2 दिन में'],
    ['ar-SA', 'ar', 'فبراير', 'بعد 2 أيام'],
    ['ru-RU', 'ru', 'февраль', 'через 2 дня'],
    ['tr-TR', 'tr', 'Şubat', '2 gün sonra'],
    ['id-ID', 'id', 'Februari', 'dalam 2 hari'],
    ['bn-BD', 'bn', 'ফেব্রুয়ারি', '2 দিন পরে'],
  ])(
    'loads real Day.js formatting for %s',
    (input, expectedCode, expectedMonth, expectedRelativeTime) => {
      expect(syncDayjsLocale(input)).toBe(expectedCode);
      const date = dayjs('2026-02-15T12:00:00');
      expect(date.format('MMMM')).toBe(expectedMonth);
      expect(date.add(2, 'day').from(date)).toBe(expectedRelativeTime);
    }
  );

  it('falls back unsupported locales to English', () => {
    expect(syncDayjsLocale('zz')).toBe('en');
    expect(dayjs.locale()).toBe('en');
  });
});
