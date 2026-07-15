import { assertEquals, assertRejects } from '@std/assert';
import { poll as pollGitHub, toHtmlUrl } from './github/mod.ts';
import { poll as pollLinear } from './linear/mod.ts';

Deno.test('plugin manifests identify independent github and linear sources', async () => {
	const github = JSON.parse(await Deno.readTextFile('./github/manifest.json'));
	const linear = JSON.parse(await Deno.readTextFile('./linear/manifest.json'));
	assertEquals(github.slug, 'github');
	assertEquals(github.entry, 'mod.ts');
	assertEquals(linear.slug, 'linear');
	assertEquals(linear.entry, 'mod.ts');
});

Deno.test('github converts API subject URLs to browser URLs', () => {
	assertEquals(
		toHtmlUrl('https://api.github.com/repos/phin-tech/dev-stream/pulls/12'),
		'https://github.com/phin-tech/dev-stream/pull/12'
	);
});

Deno.test('plugins reject missing credentials before network access', async () => {
	await assertRejects(() => pollGitHub({ config: {}, cursor: null }), Error, 'no personal access token');
	await assertRejects(() => pollLinear({ config: {}, cursor: null }), Error, 'no API key');
});
