export function sessionEvents(session) {
    if (typeof session.snapshotEvents === 'function')
        return session.snapshotEvents();
    if (Array.isArray(session.events))
        return session.events;
    throw new Error('requirements-alignment: host provides no supported session history API');
}
//# sourceMappingURL=session-events.js.map