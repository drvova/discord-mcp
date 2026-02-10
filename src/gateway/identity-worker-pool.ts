export class IdentityWorkerPool {
    private readonly queues = new Map<string, Promise<unknown>>();

    async run<T>(identityId: string, task: () => Promise<T>): Promise<T> {
        const previous = this.queues.get(identityId) || Promise.resolve();

        const current = previous
            .catch(() => undefined)
            .then(task)
            .finally(() => {
                if (this.queues.get(identityId) === current) {
                    this.queues.delete(identityId);
                }
            });

        this.queues.set(identityId, current);
        return current;
    }
}
