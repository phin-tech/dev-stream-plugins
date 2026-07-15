interface PollContext { config: Record<string, unknown>; cursor: string | null }
interface Notification {
	id: string; updated_at: string; reason: string;
	repository: { full_name: string };
	subject: { title: string; url: string | null; type: string };
}
interface Subject {
	number?: number; html_url?: string; state?: string; merged?: boolean; draft?: boolean;
	user?: { login?: string }; assignees?: { login?: string }[];
}

export function toHtmlUrl(apiUrl: string | null): string | undefined {
	if (!apiUrl) return undefined;
	try {
		const url = new URL(apiUrl);
		if (!url.hostname.endsWith('github.com')) return undefined;
		const path = url.pathname.replace(/^\/repos\//, '/').replace(/\/pulls\//, '/pull/');
		return `https://github.com${path}`;
	} catch { return undefined; }
}

const kind = (type: string) => type === 'PullRequest' ? 'pr' : type === 'Issue' ? 'issue' : type === 'CheckSuite' ? 'alert' : 'event';
function title(n: Notification, subject: Subject | null): string {
	const number = subject?.number ? `#${subject.number} ` : '';
	if (n.subject.type === 'PullRequest') {
		if (subject?.merged) return `Merged PR ${number}${n.subject.title}`;
		if (subject?.state === 'closed') return `Closed PR ${number}${n.subject.title}`;
		if (n.reason === 'review_requested') return `Review requested: ${number}${n.subject.title}`;
		return `PR ${number}${n.subject.title}`;
	}
	if (n.subject.type === 'Issue') return subject?.state === 'closed' ? `Closed issue ${number}${n.subject.title}` : `Issue ${number}${n.subject.title}`;
	if (n.subject.type === 'CheckSuite') return `Checks: ${n.subject.title}`;
	return n.subject.title;
}

async function github<T>(url: string, token: string): Promise<T> {
	const response = await fetch(url, { headers: {
		authorization: `Bearer ${token}`, accept: 'application/vnd.github+json',
		'x-github-api-version': '2022-11-28', 'user-agent': 'dev-stream'
	}, signal: AbortSignal.timeout(15_000) });
	if (!response.ok) {
		const raw = await response.text().catch(() => '');
		let message = raw.slice(0, 200) || response.statusText;
		try { message = (JSON.parse(raw) as { message?: string }).message ?? message; } catch { /* raw text */ }
		throw new Error(response.status === 401
			? 'GitHub rejected the token (401). Check it has the notifications scope.'
			: `GitHub returned ${response.status}: ${message}`);
	}
	return await response.json() as T;
}

export async function poll({ config, cursor }: PollContext) {
	const token = typeof config.token === 'string' ? config.token.trim() : '';
	if (!token) throw new Error('no personal access token configured');
	const base = typeof config.api_base === 'string' ? config.api_base : 'https://api.github.com';
	const repos = String(config.repos ?? '').split(',').map((repo) => repo.trim()).filter(Boolean);
	const params = new URLSearchParams({ per_page: '50', since: cursor ?? new Date(Date.now() - 86_400_000).toISOString() });
	const all = await github<Notification[]>(`${base}/notifications?${params}`, token);
	const notifications = repos.length ? all.filter((n) => repos.includes(n.repository.full_name)) : all;
	let watermark = cursor;
	const posts = [];
	for (const notification of notifications) {
		let subject: Subject | null = null;
		if (notification.subject.url) {
			try { subject = await github<Subject>(notification.subject.url, token); } catch { /* optional detail */ }
		}
		const url = subject?.html_url ?? toHtmlUrl(notification.subject.url);
		const meta: Record<string, unknown> = { repo: notification.repository.full_name, reason: notification.reason };
		if (url) {
			meta.url = url;
			meta.links = [{ label: notification.subject.type === 'PullRequest' ? 'PR' : notification.subject.type === 'Issue' ? 'Issue' : 'GitHub', url }];
			if (notification.subject.type === 'PullRequest' && notification.reason === 'review_requested')
				(meta.links as Array<{ label: string; url: string }>).push({ label: 'Review', url: `${url}/files` });
		}
		if (subject?.number) meta.number = subject.number;
		if (subject?.user?.login) meta.author = subject.user.login;
		if (subject?.assignees?.length) meta.assignees = subject.assignees.map((a) => a.login).filter(Boolean);
		meta.state = subject?.merged ? 'merged' : subject?.draft ? 'draft' : subject?.state;
		posts.push({ source: 'github', kind: kind(notification.subject.type), title: title(notification, subject),
			ts: notification.updated_at, tags: ['github', notification.reason.replace(/_/g, '-')], meta,
			dedupe_key: `github:${notification.id}:${notification.updated_at}` });
		if (!watermark || notification.updated_at > watermark) watermark = notification.updated_at;
	}
	return { posts, cursor: watermark };
}
