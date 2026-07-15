interface PollContext { config: Record<string, unknown>; cursor: string | null }
interface Issue {
	id: string; identifier: string; title: string; url: string; updatedAt: string;
	state?: { name?: string; type?: string }; assignee?: { displayName?: string } | null;
	team?: { key?: string } | null; project?: { name?: string } | null;
}
interface Body { data?: { issues?: { nodes?: Issue[] } }; errors?: { message: string }[] }

const QUERY = `query DevStream($since: DateTimeOrDuration!, $first: Int!) {
	issues(filter: { updatedAt: { gt: $since } }, first: $first, orderBy: updatedAt) {
		nodes { id identifier title url updatedAt state { name type } assignee { displayName } team { key } project { name } }
	}
}`;

function title(issue: Issue): string {
	const label = `${issue.identifier}: ${issue.title}`;
	return issue.state?.type === 'completed' ? `Completed ${label}`
		: issue.state?.type === 'canceled' ? `Cancelled ${label}`
		: issue.state?.type === 'started' ? `Started ${label}` : label;
}

export async function poll({ config, cursor }: PollContext) {
	const key = typeof config.api_key === 'string' ? config.api_key.trim() : '';
	if (!key) throw new Error('no API key configured');
	const endpoint = typeof config.api_base === 'string' ? config.api_base : 'https://api.linear.app/graphql';
	const teams = String(config.teams ?? '').split(',').map((team) => team.trim().toUpperCase()).filter(Boolean);
	const since = cursor ?? new Date(Date.now() - 86_400_000).toISOString();
	const response = await fetch(endpoint, { method: 'POST', headers: { authorization: key, 'content-type': 'application/json' },
		body: JSON.stringify({ query: QUERY, variables: { since, first: 50 } }), signal: AbortSignal.timeout(15_000) });
	if (!response.ok) throw new Error(response.status === 400 || response.status === 401
		? `Linear rejected the API key (${response.status}).` : `Linear returned ${response.status}.`);
	const body = await response.json() as Body;
	if (body.errors?.length) throw new Error(`Linear: ${body.errors.map((error) => error.message).join('; ')}`);
	const all = body.data?.issues?.nodes ?? [];
	const issues = teams.length ? all.filter((issue) => issue.team?.key && teams.includes(issue.team.key.toUpperCase())) : all;
	let watermark = cursor;
	const posts = issues.map((issue) => {
		const meta: Record<string, unknown> = { url: issue.url, links: [{ label: 'Issue', url: issue.url }], identifier: issue.identifier };
		if (issue.project?.name) meta.project = issue.project.name;
		if (issue.team?.key) meta.team = issue.team.key;
		if (issue.assignee?.displayName) meta.author = issue.assignee.displayName;
		if (issue.state?.name) meta.state = issue.state.name;
		if (issue.state?.type) meta.state_type = issue.state.type;
		if (!watermark || issue.updatedAt > watermark) watermark = issue.updatedAt;
		return { source: 'linear', kind: 'issue', title: title(issue), ts: issue.updatedAt,
			tags: ['linear', ...(issue.team?.key ? [issue.team.key.toLowerCase()] : [])], meta,
			dedupe_key: `linear:${issue.id}:${issue.updatedAt}` };
	});
	return { posts, cursor: watermark };
}
