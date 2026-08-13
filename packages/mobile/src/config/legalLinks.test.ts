// The contract that keeps a dead legal link off a reviewer's screen: only a real https
// URL is surfaced; empty / http / placeholder / undefined all read as "not configured yet"
// so the AccountScreen hides the row rather than linking to a 404 (which is a worse review
// outcome than an absent link). Apple's manage-subscriptions URL is a fixed constant.
import { afterEach, describe, expect, it } from 'vitest';
import { loadLegalLinks } from './legalLinks.js';

const KEYS = [
  'EXPO_PUBLIC_PRIVACY_POLICY_URL',
  'EXPO_PUBLIC_TERMS_OF_USE_URL',
  'EXPO_PUBLIC_SUPPORT_EMAIL',
  'EXPO_PUBLIC_SUPPORT_URL',
] as const;

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe('loadLegalLinks — only a real https URL is surfaced', () => {
  it('unset env → both legal URLs null (UI hides the rows)', () => {
    const links = loadLegalLinks();
    expect(links.privacyPolicyUrl).toBeNull();
    expect(links.termsOfUseUrl).toBeNull();
  });

  it('a real https URL passes through, trimmed', () => {
    process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL = '  https://example.com/privacy  ';
    expect(loadLegalLinks().privacyPolicyUrl).toBe('https://example.com/privacy');
  });

  it.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['plain http (not secure)', 'http://example.com/privacy'],
    ['a bare placeholder token', 'REPLACE_ME'],
  ])('%s → null (treated as unconfigured)', (_label, value) => {
    process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL = value;
    expect(loadLegalLinks().privacyPolicyUrl).toBeNull();
  });

  it('manage-subscriptions is always the fixed Apple deep link', () => {
    expect(loadLegalLinks().manageSubscriptionsUrl).toBe('https://apps.apple.com/account/subscriptions');
  });
});

describe('loadLegalLinks — support contact destination', () => {
  it('unset → null (UI hides the Contact row)', () => {
    expect(loadLegalLinks().supportUrl).toBeNull();
  });

  it('a real email → a mailto: link (opens the composer)', () => {
    process.env.EXPO_PUBLIC_SUPPORT_EMAIL = '  help@example.com  ';
    expect(loadLegalLinks().supportUrl).toBe('mailto:help@example.com');
  });

  it('a hosted https support URL passes through when no email is set', () => {
    process.env.EXPO_PUBLIC_SUPPORT_URL = 'https://example.com/help';
    expect(loadLegalLinks().supportUrl).toBe('https://example.com/help');
  });

  it('email wins over URL when both are set (the policy promises an email contact)', () => {
    process.env.EXPO_PUBLIC_SUPPORT_EMAIL = 'help@example.com';
    process.env.EXPO_PUBLIC_SUPPORT_URL = 'https://example.com/help';
    expect(loadLegalLinks().supportUrl).toBe('mailto:help@example.com');
  });

  it.each([
    ['a bare placeholder', 'TBC'],
    ['REPLACE_ME token', 'REPLACE_ME'],
    ['missing domain', 'help@'],
    ['no @', 'helpexample.com'],
    ['whitespace', '   '],
  ])('%s email → null (treated as unconfigured, no broken mailto)', (_label, value) => {
    process.env.EXPO_PUBLIC_SUPPORT_EMAIL = value;
    expect(loadLegalLinks().supportUrl).toBeNull();
  });

  it('a non-https support URL is rejected (no insecure/placeholder link)', () => {
    process.env.EXPO_PUBLIC_SUPPORT_URL = 'http://example.com/help';
    expect(loadLegalLinks().supportUrl).toBeNull();
  });
});
