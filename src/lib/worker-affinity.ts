/** Keep a scene's index tiles on one worker so its COG ranges/decoded blocks
 * are fetched once. Assign successive scenes to different workers for A/B.
 * Only ownership metadata is stored here; workers retain their existing caches.
 */
export function createSceneAffinity(maxEntries = 64) {
	if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new RangeError('Invalid affinity capacity');
	const owners = new Map<string, number>();
	let next = 0;
	return (scene: string, workerCount: number): number => {
		if (!Number.isInteger(workerCount) || workerCount < 1) throw new RangeError('Invalid worker count');
		const owner = owners.get(scene);
		if (owner !== undefined) {
			owners.delete(scene);
			owners.set(scene, owner);
			return owner % workerCount;
		}
		const slot = next % workerCount;
		next = (slot + 1) % workerCount;
		if (owners.size >= maxEntries) owners.delete(owners.keys().next().value!);
		owners.set(scene, slot);
		return slot;
	};
}
