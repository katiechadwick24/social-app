#!/usr/bin/env node
// Regression checks for the Socials app's most common voice failure:
// replies that remix the source post or converge into one generic clever voice.

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'you', 'your', 'yours',
  'me', 'my', 'mine', 'i', 'im', "i'm", 'it', 'its', 'that', 'this', 'those',
  'these', 'they', 'them', 'he', 'him', 'his', 'she', 'her', 'we', 'us', 'our',
  'ours', 'just', 'really', 'very', 'so', 'bc', 'because', 'when', 'then',
  'there', 'here', 'not', 'no', 'yes', 'do', 'does', 'did', 'doing', 'say',
  'saying', 'said', 'back', 'though', 'too', 'also', 'as', 'at', 'by', 'from',
]);

const CHARACTER_CONTRACTS = {
  theo: {
    requiredAny: ['caption', 'headline', 'poll', 'ranking', 'metrics', 'engagement', 'clip', 'screenshot', 'camera', 'report', 'optics', 'crop', 'witness', 'rumor'],
    banned: ['shove', 'punch', 'hit', 'swing', 'throw hands', 'someone else problem', 'under protest'],
  },
  jude: {
    banned: ['analytics', 'metrics', 'ranking', 'poll', 'spreadsheet', 'documentation', 'shove', 'throw hands', 'headline'],
  },
  havoc: {
    requiredAny: ['sit', 'try', 'bored', 'dare', 'hit', 'swing', 'move', 'bad idea', 'say less', 'come on', 'cute', 'dangerous', 'wait', 'pretend', 'mind your business'],
    banned: ['analytics', 'metrics', 'ranking', 'poll', 'headline', 'documentation'],
  },
};

const CASES = [
  {
    name: 'rejects source-post remixes',
    source: '@keresvalen walked into practice like she owns the scoreboard. bad news for Gryffindor.',
    shouldFail: [
      { speaker: 'theo', text: 'caption: Keres walking into practice like she owns the scoreboard is bad news for engagement.' },
      { speaker: 'jude', text: 'bad news for Gryffindor. useful for me.' },
      { speaker: 'havoc', text: '@keresvalen walked in like you own it. bad idea, better timing.' },
    ],
    shouldPass: [
      { speaker: 'theo', text: 'match-week optics report: gryffindor just got subtweeted by footwork.' },
      { speaker: 'jude', text: 'awful. put it on a banner.' },
      { speaker: 'havoc', text: '@keresvalen say less. i was bored anyway.' },
    ],
  },
  {
    name: 'rejects same-clever-person pileons',
    source: '@rowancade posted "interesting angle" with zero context and @havocfang liked it within 4 seconds.',
    shouldFail: [
      { speaker: 'theo', text: 'that lands different when the like arrives in four seconds.' },
      { speaker: 'jude', text: 'that lands different when everyone can see the timing.' },
      { speaker: 'havoc', text: 'that lands different when you are all watching the like.' },
    ],
    shouldPass: [
      { speaker: 'theo', text: 'four-second like window. terrible alibi, excellent screenshot.' },
      { speaker: 'jude', text: 'subtle. everyone clap slowly.' },
      { speaker: 'havoc', text: '@rowancade next time wait five seconds and pretend you have discipline.' },
    ],
  },
  {
    name: 'rejects weak character separation',
    source: 'GMZ says someone saw Keres leaving the Gryffindor corridor before breakfast.',
    shouldFail: [
      { speaker: 'theo', text: 'someone needs to explain the corridor thing.' },
      { speaker: 'jude', text: 'someone needs to explain the breakfast thing.' },
      { speaker: 'havoc', text: 'someone needs to explain why this is a thing.' },
    ],
    shouldPass: [
      { speaker: 'theo', text: 'breakfast corridor rumor has three possible crops and zero calm witnesses.' },
      { speaker: 'jude', text: 'allegedly is doing heroic work there.' },
      { speaker: 'havoc', text: 'if you saw something before breakfast, mind your business faster.' },
    ],
  },
];

function words(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/@[a-z0-9_]+/g, '')
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function contentWords(text) {
  return words(text).filter(w => !STOP_WORDS.has(w) && w.length > 2 && !/^\d+$/.test(w));
}

function ngrams(list, min = 3, max = 4) {
  const out = new Set();
  for (let size = min; size <= max; size++) {
    for (let i = 0; i <= list.length - size; i++) out.add(list.slice(i, i + size).join(' '));
  }
  return out;
}

function jaccard(a, b) {
  const aa = new Set(a);
  const bb = new Set(b);
  if (!aa.size || !bb.size) return 0;
  let hits = 0;
  aa.forEach(item => { if (bb.has(item)) hits += 1; });
  return hits / (aa.size + bb.size - hits);
}

function sharedCount(a, b) {
  const bb = new Set(b);
  return new Set(a).size ? [...new Set(a)].filter(item => bb.has(item)).length : 0;
}

function patternFlags(text) {
  const clean = words(text).join(' ');
  const flags = new Set();
  if (/\b(?:land|lands|landed|hit|hits|work|works|read|reads|sound|sounds)\b.{0,40}\b(?:when|because|from)\b/.test(clean)) flags.add('verb-connector');
  if (/\b(?:someone|everyone|somebody)\s+needs\s+to\b/.test(clean)) flags.add('someone-needs-to');
  if (/\b(?:bad|terrible|awful|great|excellent|useful)\s+for\b/.test(clean)) flags.add('x-for-y');
  if (/\b(?:caption|headline|ranking|poll|metrics|engagement|screenshot|crop|report|documentation)\b/.test(clean)) flags.add('media-frame');
  if (/^[a-z]+\.?\s+[a-z]+\.?$/i.test(String(text).trim())) flags.add('two-fragments');
  if (/\?$/.test(String(text).trim())) flags.add('question');
  return flags;
}

function hasSharedNgram(a, b) {
  const an = ngrams(contentWords(a));
  const bn = ngrams(contentWords(b));
  for (const phrase of an) if (bn.has(phrase)) return true;
  return false;
}

function sourceEchoFindings(source, reply) {
  const sourceWords = contentWords(source);
  const replyWords = contentWords(reply.text);
  const overlap = jaccard(sourceWords, replyWords);
  const shared = sharedCount(sourceWords, replyWords);
  const findings = [];

  if (hasSharedNgram(source, reply.text)) findings.push('copies source ngram');
  if (shared >= 3 && overlap >= 0.34) findings.push(`source overlap ${overlap.toFixed(2)}`);
  if (words(source).slice(0, 4).join(' ') === words(reply.text).slice(0, 4).join(' ')) findings.push('same opening as source');
  return findings;
}

function pairFindings(a, b) {
  const findings = [];
  const overlap = jaccard(contentWords(a.text), contentWords(b.text));
  if (hasSharedNgram(a.text, b.text)) findings.push('shared reply ngram');
  if (overlap >= 0.42) findings.push(`reply overlap ${overlap.toFixed(2)}`);

  const af = patternFlags(a.text);
  const bf = patternFlags(b.text);
  for (const flag of af) {
    if (bf.has(flag) && flag !== 'media-frame') findings.push(`same pattern ${flag}`);
  }
  return findings;
}

function contractFindings(reply) {
  const spec = CHARACTER_CONTRACTS[reply.speaker];
  if (!spec) return [];
  const lower = String(reply.text || '').toLowerCase();
  const findings = [];
  if (spec.banned?.some(term => lower.includes(term))) findings.push(`${reply.speaker} crossed voice lane`);
  if (spec.requiredAny && !spec.requiredAny.some(term => lower.includes(term))) {
    findings.push(`${reply.speaker} weak lane signal`);
  }
  return findings;
}

function evaluateReplies(source, replies) {
  const findings = [];
  replies.forEach(reply => {
    sourceEchoFindings(source, reply).forEach(reason => findings.push(`${reply.speaker}: ${reason}`));
    contractFindings(reply).forEach(reason => findings.push(`${reply.speaker}: ${reason}`));
  });
  for (let i = 0; i < replies.length; i++) {
    for (let j = i + 1; j < replies.length; j++) {
      pairFindings(replies[i], replies[j]).forEach(reason => {
        findings.push(`${replies[i].speaker}/${replies[j].speaker}: ${reason}`);
      });
    }
  }
  return findings;
}

function run() {
  const failures = [];
  for (const testCase of CASES) {
    const badFindings = evaluateReplies(testCase.source, testCase.shouldFail);
    const goodFindings = evaluateReplies(testCase.source, testCase.shouldPass);

    if (!badFindings.length) {
      failures.push(`${testCase.name}: bad fixture was not caught`);
    }
    if (goodFindings.length) {
      failures.push(`${testCase.name}: good fixture tripped findings: ${goodFindings.join('; ')}`);
    }
  }

  if (failures.length) {
    process.stderr.write('character voice regression eval FAILED\n');
    failures.forEach(line => process.stderr.write(`- ${line}\n`));
    process.exit(1);
  }

  process.stdout.write(`character voice regression eval OK (${CASES.length} cases)\n`);
}

run();
