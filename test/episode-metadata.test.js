'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    getSeasons,
    needsSeasonHydration,
    mergeSeasonDetail,
    episodeNumbersForSeason
} = require('../episode-metadata');

test('TV details with no seasons are marked for hydration', () => {
    assert.equal(needsSeasonHydration({
        subject: { subjectType: 2 },
        resource: { seasons: [] }
    }), true);
});

test('movies and TV details with seasons do not need hydration', () => {
    assert.equal(needsSeasonHydration({
        subject: { subjectType: 1 },
        resource: { seasons: [] }
    }), false);
    assert.equal(needsSeasonHydration({
        subject: { subjectType: 2 },
        resource: { seasons: [{ se: 1, maxEp: 10 }] }
    }), false);
});

test('an empty resource season array does not hide seasons nested under the subject', () => {
    const payload = {
        subject: {
            subjectType: 2,
            resource: { seasons: [{ se: 1, maxEp: 10 }] },
            seasons: [{ se: 2, maxEp: 8 }]
        },
        resource: { seasons: [] }
    };
    assert.deepEqual(getSeasons(payload), [{ se: 1, maxEp: 10 }]);
    assert.equal(needsSeasonHydration(payload), false);
    assert.deepEqual(getSeasons({
        subject: { subjectType: 2, seasons: [{ se: 2, maxEp: 8 }] },
        resource: { seasons: [] }
    }), [{ se: 2, maxEp: 8 }]);
});

test('season details merge without replacing existing title metadata', () => {
    const base = {
        subject: { subjectId: '42', subjectType: 2, title: 'Original title', detailPath: 'show-42' },
        resource: { source: 'original', seasons: [] }
    };
    const detail = {
        subject: { subjectId: '42', title: 'Title with season suffix' },
        resource: { source: 'detail', seasons: [{ se: 1, maxEp: 10 }] }
    };
    const merged = mergeSeasonDetail(base, detail, '42');

    assert.equal(merged.subject.title, 'Original title');
    assert.equal(merged.resource.source, 'original');
    assert.deepEqual(merged.resource.seasons, [{ se: 1, maxEp: 10 }]);
});

test('season details from a different subject are rejected', () => {
    const base = {
        subject: { subjectId: '42', subjectType: 2, title: 'Original title' },
        resource: { seasons: [] }
    };
    const detail = {
        subject: { subjectId: '99' },
        resource: { seasons: [{ se: 1, maxEp: 10 }] }
    };
    assert.equal(mergeSeasonDetail(base, detail, '42'), base);
});

test('explicit allEp values are respected instead of inventing missing episodes', () => {
    assert.deepEqual(
        episodeNumbersForSeason({ maxEp: 4, allEp: '1,3,4' }),
        [1, 3, 4]
    );
});

test('a continuous episode range is derived only when allEp is absent', () => {
    assert.deepEqual(
        episodeNumbersForSeason({ maxEp: 3, allEp: '' }),
        [1, 2, 3]
    );
    assert.deepEqual(episodeNumbersForSeason({}), []);
});
