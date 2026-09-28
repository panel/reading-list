import { describe, expect, it } from 'vitest';
import { OpmlParseError, parseOpml, toOpml } from './opml';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
  <head><title>Feeds from another reader</title></head>
  <body>
    <outline text="Tech" title="Tech">
      <outline type="rss" text="Ada &amp; Co" xmlUrl="https://ada.example/feed.xml" htmlUrl="https://ada.example/"/>
      <outline text="Nested group">
        <outline type="rss" text="Deep" xmlUrl="https://deep.example/rss"/>
      </outline>
    </outline>
    <outline type="rss" title="Loose feed" text="ignored when title set" xmlUrl="https://loose.example/atom.xml"/>
    <outline type="rss" text="Duplicate" xmlUrl="https://ada.example/feed.xml"/>
    <outline type="rss" text="Bad scheme" xmlUrl="javascript:alert(1)"/>
    <outline text="Empty folder"/>
  </body>
</opml>`;

describe('parseOpml', () => {
	it('reads feeds with folders, dedupes, and skips non-http URLs', () => {
		expect(parseOpml(SAMPLE)).toEqual([
			{
				url: 'https://ada.example/feed.xml',
				title: 'Ada & Co',
				siteUrl: 'https://ada.example/',
				folder: 'Tech'
			},
			{ url: 'https://deep.example/rss', title: 'Deep', siteUrl: null, folder: 'Tech' },
			{ url: 'https://loose.example/atom.xml', title: 'Loose feed', siteUrl: null, folder: null }
		]);
	});

	it('handles a single outline and rejects non-OPML', () => {
		expect(
			parseOpml('<opml><body><outline xmlUrl="https://one.example/feed" text="One"/></body></opml>')
		).toHaveLength(1);
		expect(() => parseOpml('<rss><channel/></rss>')).toThrow(OpmlParseError);
		expect(() => parseOpml('<opml><body>')).toThrow(OpmlParseError);
	});
});

describe('toOpml', () => {
	it('round-trips through parseOpml and escapes values', () => {
		const feeds = [
			{
				url: 'https://a.example/feed?x=1&y=2',
				title: 'A "quoted" <title>',
				siteUrl: 'https://a.example/',
				folder: 'News & Views'
			},
			{ url: 'https://b.example/rss', title: null, siteUrl: null, folder: null }
		];
		const xml = toOpml(feeds, 'Mine', new Date('2026-09-28T00:00:00Z'));
		expect(xml).toContain('<dateCreated>Mon, 28 Sep 2026 00:00:00 GMT</dateCreated>');
		expect(xml).not.toContain('<title>"');
		expect(parseOpml(xml)).toEqual([feeds[0], { ...feeds[1], title: 'https://b.example/rss' }]);
	});
});
