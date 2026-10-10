'use strict';

function contentOf(payload) {
    if (!payload || typeof payload !== 'object') return {};
    if (payload.data && typeof payload.data === 'object' && !payload.subject && !payload.resource) {
        return payload.data;
    }
    return payload;
}

function getSeasons(payload) {
    const data = contentOf(payload);
    const subject = data.subject || {};
    const resource = data.resource || {};
    const subjectResource = subject.resource || {};
    const candidates = [resource.seasons, subjectResource.seasons, subject.seasons, subject.seasonList];
    return candidates.find(seasons => Array.isArray(seasons) && seasons.length > 0) || [];
}

function isTvSeries(payload) {
    const subject = contentOf(payload).subject || {};
    return Number(subject.subjectType ?? subject.type) === 2;
}

function needsSeasonHydration(payload) {
    return isTvSeries(payload) && getSeasons(payload).length === 0;
}

function mergeSeasonDetail(basePayload, detailPayload, expectedSubjectId) {
    const base = contentOf(basePayload);
    const detail = contentOf(detailPayload);
    const detailSubject = detail.subject || {};
    const detailSubjectId = detailSubject.subjectId || detail.subjectId;

    if (expectedSubjectId && detailSubjectId &&
        String(detailSubjectId) !== String(expectedSubjectId)) {
        return basePayload;
    }

    const seasons = getSeasons(detail);
    if (seasons.length === 0) return basePayload;

    return {
        ...base,
        subject: {
            ...(detail.subject || {}),
            ...(base.subject || {})
        },
        resource: {
            ...(detail.resource || {}),
            ...(base.resource || {}),
            seasons
        }
    };
}

function episodeNumbersForSeason(season, limit = 120) {
    if (!season || typeof season !== 'object') return [];

    const rawEpisodes = Array.isArray(season.allEp)
        ? season.allEp
        : typeof season.allEp === 'string'
            ? season.allEp.split(',')
            : [];
    const listedEpisodes = [...new Set(rawEpisodes
        .map(value => Number.parseInt(String(value).trim(), 10))
        .filter(value => Number.isInteger(value) && value > 0))]
        .sort((a, b) => a - b);

    if (listedEpisodes.length > 0) return listedEpisodes;

    const count = Number.parseInt(season.maxEp ?? season.episodes ?? season.epCount, 10);
    if (!Number.isInteger(count) || count <= 0) return [];
    return Array.from({ length: Math.min(count, limit) }, (_, index) => index + 1);
}

module.exports = {
    contentOf,
    getSeasons,
    isTvSeries,
    needsSeasonHydration,
    mergeSeasonDetail,
    episodeNumbersForSeason
};
