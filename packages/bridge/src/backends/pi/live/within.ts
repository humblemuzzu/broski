/** `work`'s value, or `onDeadline` once `deadlineMs` pass first; the timer goes as soon as either settles. */
export async function within<T, U>(work: Promise<T>, deadlineMs: number, onDeadline: U): Promise<T | U> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<U>((resolve) => {
		timer = setTimeout(() => resolve(onDeadline), Math.max(0, deadlineMs));
	});
	try {
		return await Promise.race([work, deadline]);
	} finally {
		clearTimeout(timer);
	}
}
