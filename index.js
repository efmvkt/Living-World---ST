// Living World — «Живой мир» для SillyTavern
// Состояние героя, его расписание и дела, живые NPC, тренды мира, календарь, газета, концовки.
// Данные хранятся в самом чате (у каждой истории свой мир).

(() => {
    'use strict';

    const EXT = 'ST-LivingWorld';
    const META = 'living_world';
    const DEFAULTS = {
        enabled: true,     // расширение включено
        auto: true,        // автообновление
        every: 4,          // раз в сколько ответов персонажа обновлять
        inject: true,      // подмешивать состояние в промпт
        notify: true,      // всплывающие уведомления
        floating: true,    // плавающая кнопка
        fullPreset: false, // обновлять через полный пресет (дороже, экспериментально)
        profileId: '',     // профиль подключения для запросов расширения ('' = основное подключение)
        frozen: false,     // заморозить чувства: дела, мир и календарь продолжают обновляться
        theme: 'pink',     // pink | lavender | wine | auto
        cute: true,        // милые всплывающие окна
        mWorld: true,      // живые NPC и тренды мира
        mNeeds: true,      // быт: энергия, сон, еда, счастье, влечение
        mEnd: true,        // архив концовок
        mCal: true,        // календарь
        extra: '',         // свои пожелания к миру
        pos: null,
    };

    // ─── helpers ───────────────────────────────────────────────────────────

    const ctx = () => SillyTavern.getContext();
    const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
    // данные состояния могут прийти из импортированного файла или чужого чата, поэтому всё, что идёт в HTML, приводим к безопасному виду
    const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const pct = v => clamp(num(v), 0, 100);
    const cls = v => String(v ?? '').replace(/[^\w-]/g, '');
    const str = v => (typeof v === 'string' ? v.trim() : (v == null ? '' : String(v).trim()));

    function S() {
        const all = ctx().extensionSettings;
        if (!all[EXT]) all[EXT] = {};
        const s = all[EXT];
        for (const k in DEFAULTS) if (s[k] === undefined) s[k] = DEFAULTS[k];
        return s;
    }
    const saveS = () => ctx().saveSettingsDebounced();

    // ─── герой Системы: один персонаж или выбранный участник группового чата ───

    const META_G = 'living_group';   // { focus: avatar, states: { avatar: state } }

    const isGroup = () => !!ctx().groupId;

    function groupInfo() {
        const c = ctx();
        if (!c.groupId) return null;
        const g = (c.groups || []).find(x => String(x.id) === String(c.groupId));
        if (!g) return null;
        const members = (g.members || []).map(av => (c.characters || []).find(ch => ch.avatar === av)).filter(Boolean);
        return { group: g, members };
    }
    function groupStore(create) {
        const md = ctx().chatMetadata;
        if (!md) return null;
        if (!md[META_G] && create) md[META_G] = { focus: '', states: {} };
        return md[META_G] || null;
    }
    function focusKey() {
        const gi = groupInfo();
        if (!gi) return null;
        const f = groupStore(false)?.focus;
        return (f && gi.members.some(m => m.avatar === f)) ? f : null;
    }
    function focusChar() {
        const c = ctx();
        if (!isGroup()) return c.characters?.[c.characterId] || null;
        const k = focusKey();
        return k ? (groupInfo()?.members.find(m => m.avatar === k) || null) : null;
    }
    const focusName = () => focusChar()?.name || ctx().name2 || 'Персонаж';

    function setFocus(av) {
        const gs = groupStore(true);
        if (!gs) return;
        gs.focus = av;
        const c = ctx();
        if (typeof c.saveMetadata === 'function') c.saveMetadata();
        applyInjection();
        render();
    }

    function getState() {
        const md = ctx().chatMetadata;
        if (!md) return null;
        if (isGroup()) {
            const k = focusKey();
            return k ? (md[META_G]?.states?.[k] || null) : null;
        }
        return md[META] || null;
    }
    function setState(st) {
        const c = ctx();
        if (!c.chatMetadata) return;
        if (isGroup()) {
            const k = focusKey();
            if (!k) return;
            const gs = groupStore(true);
            if (st) gs.states[k] = st; else delete gs.states[k];
        } else if (st) {
            c.chatMetadata[META] = st;
        } else {
            delete c.chatMetadata[META];
        }
        if (typeof c.saveMetadata === 'function') c.saveMetadata();
    }

    // сколько ответов персонажа в чате — «ходы» (устойчиво к свайпам и удалениям)
    const turns = () => ctx().chat.filter(m => m && !m.is_user && !m.is_system).length;

    function toast(msg, type = 'info', force = false) {
        if (typeof toastr === 'undefined') return;
        if (!force && !S().notify) return;
        toastr[type](msg, '✦ Живой мир');
    }

    // ─── милые всплывающие окна (как уведомления в манхве) ────────────────


    function popup(kind, text, title) {
        if (!S().notify) return;
        const [icon, def] = POP[kind] || POP.event;
        if (!S().cute) { toast(`${title || def}: ${text}`, kind === 'penalty' ? 'warning' : 'info'); return; }
        let box = document.getElementById('lw-popups');
        if (!box) {
            box = document.createElement('div');
            box.id = 'lw-popups';
            document.body.appendChild(box);
        }
        const el = document.createElement('div');
        el.className = `lw-pop lw-pop-${kind}`;
        el.innerHTML = `<span class="lw-pop-ic">${icon}</span><div class="lw-pop-tx"><b>${esc(title || def)}</b><span>${esc(text)}</span></div><i class="lw-spark">✧</i><i class="lw-spark s2">✦</i>`;
        el.addEventListener('click', () => el.remove());
        box.appendChild(el);
        setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, 5000);
        while (box.children.length > 4) box.firstChild.remove();
    }

    const POP = {
        agenda: ['📋', 'Дело'], done: ['✅', 'Готово'], away: ['⏳', 'Пока вас не было'], world: ['🌍', 'Мир'], npc: ['🧑‍🤝‍🧑', 'Жители'],
        need: ['🍽️', 'Быт'], event: ['✦', 'Событие'], stage: ['💞', 'Этап отношений'], news: ['📰', 'Газета'], stat: ['💗', 'Чувства'],
    };

    // что показать после обновления: сравниваем старое состояние с новым
    function announce(old, st) {
        if (!old) {
            popup('stage', st.stage || 'Мир создан', 'Мир запущен ✦');
            const n = (st.npcs || []).length;
            if (n) setTimeout(() => popup('npc', `Живых персонажей: ${n}`, 'Мир заселён'), 500);
            return;
        }
        const out = [];
        if (st.away && st.away.turn === st.lastTurn) out.push(['away', `${st.away.days ? `Дней прошло: ${st.away.days}. ` : ''}${st.away.lines[0] || ''}`, 'Пока вас не было']);
        const oldA = new Map((old.agenda || []).map(a => [a.id, a]));
        for (const a of st.agenda) {
            const o = oldA.get(a.id);
            if (!o && a.status === 'active') out.push(['agenda', `«${a.title}»`, 'Новое дело героя']);
            else if (o && o.status === 'active' && a.status === 'done') out.push(['done', `«${a.title}»`, 'Дело завершено']);
        }
        if (st.stage && old.stage && st.stage !== old.stage) out.push(['stage', st.stage, 'Этап отношений изменился']);
        st.stats.filter(x => Math.abs(x.value - x.prev) >= 6).slice(0, 2).forEach(x => {
            const d = x.value - x.prev;
            out.push(['stat', `${x.icon} ${x.name} ${d > 0 ? '+' : ''}${d}`, d > 0 ? 'Чувства растут' : 'Чувства остывают']);
        });
        const oldT = new Map((old.trends || []).map(t => [t.id, t]));
        st.trends.forEach(t => {
            const o = oldT.get(t.id);
            if (o && Math.abs(t.value - o.value) >= 8) out.push(['world', `${t.icon} ${t.name} ${t.value > o.value ? '+' : ''}${t.value - o.value}`, 'Мир меняется']);
        });
        const oldN = new Map((old.npcs || []).map(n => [n.id, n]));
        for (const n of st.npcs) {
            const o = oldN.get(n.id);
            if (!o) out.push(['npc', `${n.name}, ${n.role}`, 'Новое лицо в мире']);
            else if (o.status === 'active' && n.status !== 'active') out.push(['npc', `${n.name}: ${n.status === 'away' ? 'в отъезде' : 'выбыл(а) из истории'}`, 'Перемена в мире']);
        }
        if (st.needs && old.needs) {
            let shown = 0;
            for (const [k, ic, label, kind] of NEEDS) {
                if (shown >= 2 || kind === 'neutral') continue;
                const n = st.needs[k], o = old.needs[k];
                if (n && o && needCrit(kind, n.value) && !needCrit(kind, o.value)) {
                    out.push(['need', `${ic} ${label}: ${n.value}%`, kind === 'good' ? 'Силы на исходе' : 'Становится тяжело']);
                    shown++;
                }
            }
        }
        const oldE = new Map((old.calendar?.events || []).map(e => [e.id, e]));
        const newE = (st.calendar?.events || []).filter(e => !oldE.has(e.id) && e.status === 'upcoming');
        if (newE.length) out.push(['event', newE.slice(0, 2).map(e => e.title).join(', ') + (newE.length > 2 ? ` и ещё ${newE.length - 2}` : ''), 'Новое в календаре']);
        for (const e of (st.calendar?.events || [])) {
            const o = oldE.get(e.id);
            if (o && o.status === 'upcoming' && e.status === 'done') out.push(['done', e.title, 'Событие состоялось']);
        }
        out.slice(0, 5).forEach(([k, text, title], i) => setTimeout(() => popup(k, text, title), i * 450));
    }

    function clean(t) {
        return String(t || '')
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/\[IB\][\s\S]*?\[\/IB\]/gi, '')
            .replace(/<[^>]+>/g, '')
            .replace(/[ \t]+\n/g, '\n')
            .trim();
    }
    function cut(t, n) {
        t = String(t || '');
        return t.length <= n ? t : t.slice(0, Math.round(n * 0.6)) + ' … ' + t.slice(-Math.round(n * 0.4));
    }
    function recent(n, len) {
        return ctx().chat.filter(m => m && !m.is_system).slice(-n)
            .map(m => `${m.name}: ${cut(clean(m.mes), len)}`).join('\n\n');
    }
    const field = (ch, k) => ch?.[k] ?? ch?.data?.[k] ?? '';

    function extractJson(t) {
        if (!t || typeof t !== 'string') return null;
        t = t.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '');
        const a = t.indexOf('{'), b = t.lastIndexOf('}');
        if (a < 0 || b <= a) return null;
        const body = t.slice(a, b + 1);
        try { return JSON.parse(body); } catch (e) { /* пробуем починить */ }
        try { return JSON.parse(body.replace(/,\s*([}\]])/g, '$1')); } catch (e) { /* не вышло */ }
        return null;
    }

    // ─── даты внутри истории ───────────────────────────────────────────────

    const DAY = 86400000;
    const pad2 = n => String(n).padStart(2, '0');

    function parseDMY(v) {
        const m = String(v || '').match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
        if (!m) return null;
        let d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
        if (y < 100) y += 2000;
        if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
        return Math.floor(Date.UTC(y, mo - 1, d) / DAY);
    }
    function dayParts(n) {
        const dt = new Date(n * DAY);
        return { d: dt.getUTCDate(), m: dt.getUTCMonth() + 1, y: dt.getUTCFullYear() };
    }
    const fmtDay = n => { const p = dayParts(n); return `${pad2(p.d)}.${pad2(p.m)}`; };
    const fmtFull = n => { const p = dayParts(n); return `${pad2(p.d)}.${pad2(p.m)}.${p.y}`; };
    function rel(n, now) {
        if (n == null || now == null) return '';
        const k = n - now;
        if (k === 0) return 'сегодня';
        if (k === 1) return 'завтра';
        if (k === -1) return 'вчера';
        return k > 0 ? `через ${k} дн.` : `${-k} дн. назад`;
    }
    // «сегодня» в истории: свежая дата из инфоблока, иначе последняя, которую вернула Система
    const nowDay = st => parseDMY(lastIB()?.date) ?? st?.calendar?.day ?? null;

    function monthGrid(now, off) {
        const p = dayParts(now);
        let mm = p.m - 1 + off;
        const y = p.y + Math.floor(mm / 12);
        mm = ((mm % 12) + 12) % 12;
        const first = Math.floor(Date.UTC(y, mm, 1) / DAY);
        const wd = (new Date(first * DAY).getUTCDay() + 6) % 7;
        const dim = new Date(Date.UTC(y, mm + 1, 0)).getUTCDate();
        return { y, m: mm, first, wd, dim };
    }

    // сколько внутриисторических дней прошло с прошлого обновления (по дате из инфоблока)
    function gapDays(st) {
        const ib = parseDMY(lastIB()?.date);
        const b = st?.calendar?.day;
        return (ib != null && b != null) ? ib - b : 0;
    }

    function skipNote(st) {
        const g = gapDays(st);
        if (g < 2) return '';
        return `TIME SKIP: ${g} in-story days have passed since the last update. Simulate the whole interval: advance the hero's affairs and the NPCs' affairs by what could plausibly happen in ${g} days, shift the trends, resolve calendar events that fell into the interval, update where/today for the new moment. Then fill "digest" with 3-6 short lines of what happened in the world while the player was not watching (consistent with the numbers you return).`;
    }

    // если срок дела или дата события прошла, а итог не подведён, просим модель решить
    function overdueNote(st) {
        const now = nowDay(st);
        if (!st || now == null) return '';
        const parts = [];
        const oa = st.agenda.filter(a => a.status === 'active' && a.dueDay != null && a.dueDay < now);
        if (oa.length) parts.push(`The target day passed for these affairs of the character: ${oa.map(a => `"${a.title}" (id ${a.id}, progress ${a.progress}%)`).join('; ')}. Resolve each one: status "done" if it was plausibly completed (in the chat or offscreen), "dropped" if it was abandoned for a story reason, otherwise keep it active with a new due_in_days. The world is lenient: no penalties.`);
        if (!S().mCal || !st.calendar?.events?.length) return parts.join(' ');
        const od = st.calendar.events.filter(e => e.status === 'upcoming' && e.day != null && e.day < now);
        if (od.length) parts.push(`The in-story date passed for these calendar events: ${od.map(e => `"${e.title}" (id ${e.id})`).join('; ')}. Resolve each one: "done" if it happened (in the chat or plausibly offscreen), "cancelled" if the story prevented it.`);
        return parts.join(' ');
    }

    // ─── prompts ───────────────────────────────────────────────────────────

    const SCHEMA_BASE = `{
  "profile": "<only when creating: 5-7 sentences in Russian — who the character is, the setting, the relationship premise, his/her wounds and secrets. When updating: copy the existing profile>",
  "stage": "<short label of the current relationship stage with the player, e.g. 'Холодное перемирие'>",
  "mood": {"emoji": "<one emoji>", "label": "<2-3 words>"},
  "thought": "<what the character thinks RIGHT NOW, first person, 1-2 short sentences>",
  "shows": "<how the character outwardly behaves, up to 12 words>",
  "hides": "<what the character really feels but hides, up to 12 words>",
  "dream": "<what the character dreams about, up to 14 words>",
  "wants": "<what the character wants right now, up to 12 words>",
  "loves": ["<something the character likes or loves, 1-3 words>"],
  "fears": ["<something the character fears or dislikes, 1-3 words>"],
  "stats": [{"name": "<Russian name>", "icon": "<emoji>", "value": 0}],
  "where": {"place": "<where the character is right now>", "doing": "<what the character is doing right now, up to 12 words>", "with": "<who is with the character, or empty>", "next": "<what the character plans to do after this scene, or empty>"},
  "agenda": [{"id": "a1", "type": "duty|social|personal|project|secret", "title": "<the character's OWN affair, short>", "desc": "<1 sentence>", "progress": 0, "due_in_days": null, "status": "active|done|dropped", "involves_player": false}],
  "today": [{"slot": "morning|day|evening|night", "title": "<what the character does>", "place": ""}],
  "ending": "<one line: where this route is heading>",
  "digest": ["<only when the NOTE reports a time skip: one short line of what happened in the world meanwhile; otherwise an empty array>"],
  "events": [{"type": "hero|npc|world", "text": "<one short line>"}],
  "memories": ["<only NEW durable facts: promises, conflicts, insults, gifts, secrets, confessions; max 3, one short line each>"],
  "diary": "<optional: one private diary line of the character, or empty string>"@@EXTRA@@
}`;

    function buildSchema() {
        const s = S();
        let extra = '';
        if (s.mWorld) extra += `,
  "npcs": [{"id": "n1", "name": "", "role": "<who they are to the character, 2-4 words>", "doing": "<what they are doing now, up to 12 words>", "place": "", "goal": "<their own goal, up to 10 words>", "attitude": "<attitude to the character, up to 8 words>", "status": "active|away|gone"}],
  "trends": [{"id": "t1", "name": "<Russian name>", "icon": "<emoji>", "value": 0, "note": "<short reason, up to 10 words>"}]`;
        if (s.mNeeds) extra += `,
  "needs": {"energy": 0, "sleepy": 0, "satiety": 0, "appetite": 0, "health": 0, "happiness": 0, "stress": 0, "desire": 0, "social": 0},
  "body_note": "<short phrase about the physical state, up to 12 words, e.g. 'не спал ночь, пропустил обед'>"`;
        if (s.mEnd) extra += `,
  "endings": [{"id": "e1", "kind": "good|neutral|bad|true", "title": "", "hint": "<what has to happen>", "progress": 0, "revealed": true}]`;
        if (s.mCal) extra += `,
  "calendar": {"today": "<current in-story date as DD.MM.YYYY>", "events": [{"id": "c1", "title": "", "type": "ball|meeting|duty|trip|holiday|deadline|market|other", "in_days": 0, "time": "<HH:MM or empty>", "place": "", "note": "<short>", "agenda": "<linked affair id or empty>", "status": "upcoming|done|cancelled"}]}`;
        return SCHEMA_BASE.replace('@@EXTRA@@', extra);
    }

    function moduleRules() {
        const s = S();
        let r = '';
        if (s.mWorld) r += `- npcs: 4-6 recurring figures around the character (family, colleagues, rivals, servants, friends, authorities). Each has their OWN goal and lives offscreen: at every update move 1-2 of them one step forward (their "doing" and "place" change, their goal advances or shifts). Keep ids stable. Not everyone revolves around the player or the hero. status "away" = temporarily out of the picture, "gone" = left the story. Add a new figure only when the story or the world calls for one.
- trends: 3-4 meters of the world that fit THIS setting (for example political tension, prices, public mood, safety in the city, war news). Values 0-100. They change slowly (usually 0-6 per update), more only after big events. Keep names and ids stable. note = one short reason for the current value.
`;
        if (s.mNeeds) r += `- needs: everyday meters of the character, 0-100. energy = physical strength (100 = full of energy); sleepy = how much the character wants to sleep (100 = barely awake); satiety = fullness (100 = full); appetite = how much the character wants to eat right now (100 = ravenous); health = wellbeing (100 = perfect); happiness = how happy the character is (100 = very happy); stress = tension (100 = at the limit); desire = romantic and physical attraction toward the player (a plain number, never explicit); social = need for company (100 = craves company, 0 = wants solitude). They follow the story: time of day, meals, sleep, work, injuries, weather and scenes with the player. Energy falls through the day and recovers with rest and sleep; sleepy grows in the evening, at night and after exertion and drops after sleep; satiety falls by roughly 10-15 per few in-story hours without food and rises after a meal; appetite is the opposite of satiety plus cravings. Use the in-story time that has passed (infoblock time, TIME SKIP) to move them. Change them gradually unless the chat shows eating, sleeping, a fight, an illness and the like. desire changes slowly and only through real closeness, chemistry and tension in the scenes, never without cause. body_note = one short phrase about the physical state.
`;
        if (s.mEnd) r += `- endings: 3-5 possible story directions (tendencies, not scripts; do not spoil). Keep ids stable. progress 0-100 = how close the story is to each right now. A "true" ending stays revealed=false until the story has clearly opened it. Set "ending" to the one-line direction of the leading route.
`;
        if (s.mCal) r += `- calendar.today: the current in-story date as DD.MM.YYYY. Take it from the chat or the infoblock; if the story gives none, invent a plausible one for the setting and keep it consistent with the previous value (it moves forward only as story time passes).
- calendar.events: plan the next ~3 weeks of this world as 4-8 upcoming events on concrete days (in_days counted from today, 0 = today): holidays and seasonal customs, fairs and markets, balls and receptions, duties, trips, deadlines, meetings among the NPCs and events of the character's own life. Tie some of them to the character's affairs (put the affair id). Keep ids stable and do not move events without a story reason. A passed event must be resolved: "done" if it happened (in the chat or plausibly offscreen), "cancelled" if the story prevented it. No consequences or penalties.
`;
        return r;
    }

    function compactCal(st) {
        const cal = st.calendar;
        if (!cal) return null;
        const now = nowDay(st);
        return {
            today: now != null ? fmtFull(now) : (cal.today || ''),
            events: (cal.events || []).map(e => ({
                id: e.id, title: e.title, type: e.type, in_days: (e.day != null && now != null) ? e.day - now : null,
                time: e.time, place: e.place, note: e.note, agenda: e.agenda, status: e.status,
            })),
        };
    }

    function compact(st) {
        if (!st) return null;
        const now = nowDay(st);
        return {
            stage: st.stage, mood: st.mood, thought: st.thought, dream: st.dream, wants: st.wants, loves: st.loves, fears: st.fears,
            stats: st.stats.map(x => ({ name: x.name, icon: x.icon, value: x.value })),
            where: st.where,
            agenda: st.agenda.map(a => ({
                id: a.id, type: a.type, title: a.title, desc: a.desc, progress: a.progress,
                due_in_days: (a.dueDay != null && now != null) ? a.dueDay - now : null, status: a.status,
            })),
            today: st.today,
            memories: (st.memories || []).slice(0, 8).map(m => m.text),
            ...(S().mNeeds && st.needs ? { needs: Object.fromEntries(Object.entries(st.needs).map(([k, v]) => [k, v.value])), body_note: st.bodyNote } : {}),
            ...(S().mWorld ? {
                npcs: (st.npcs || []).map(n => ({ id: n.id, name: n.name, role: n.role, doing: n.doing, place: n.place, goal: n.goal, attitude: n.attitude, status: n.status })),
                trends: (st.trends || []).map(x => ({ id: x.id, name: x.name, icon: x.icon, value: x.value, note: x.note })),
            } : {}),
            ...(S().mEnd ? { endings: (st.endings || []).map(e => ({ id: e.id, kind: e.kind, title: e.title, progress: e.progress, revealed: e.revealed })) } : {}),
            ...(S().mCal ? { calendar: compactCal(st) } : {}),
        };
    }

    function buildPrompts(old, full, note) {
        const c = ctx();
        const s = S();
        const ch = focusChar();
        const cn = focusName();
        const un = c.name1 || 'User';

        const system = `You are the hidden "World engine" of a roleplay. You read the story and keep the living state of the world around the character ${cn}: the character's inner state, his/her own schedule and affairs, the NPCs, the trends of the world. The world lives on its own and does not wait for the player (${un}). Reply with ONE valid JSON object only: no markdown, no comments, no text outside the JSON. All text values must be in Russian.`;

        let p = '';
        if (!full) {
            if (old) {
                p += `CHARACTER PROFILE (${cn}): ${old.profile || ''}\n\n`;
            } else {
                p += `CHARACTER CARD (${cn}):\n${cut(field(ch, 'description'), 7000)}\n`;
                const pers = field(ch, 'personality'), scen = field(ch, 'scenario');
                if (pers) p += `Personality: ${cut(pers, 800)}\n`;
                if (scen) p += `Scenario: ${cut(scen, 1200)}\n`;
                p += '\n';
            }
        } else if (old) {
            p += `CHARACTER PROFILE (${cn}): ${old.profile || ''}\n\n`;
        }
        p += `PLAYER PERSONA: ${un}\n`;
        const gi0 = groupInfo();
        if (gi0) p += `GROUP CHAT with several characters (${gi0.members.map(m => m.name).join(', ')}). Track ONLY ${cn} as the hero of this window; all other characters are NPCs here.\n`;
        const ib0 = lastIB();
        if (ib0?.date) p += `IN-STORY DATE (from the chat's infoblock): ${ib0.date}${ib0.time ? ', ' + ib0.time : ''}${ib0.loc ? ', ' + ib0.loc : ''}\n`;
        if (s.extra.trim()) p += `PLAYER'S EXTRA WISHES: ${s.extra.trim()}\n`;
        p += `\nCURRENT STATE (turn ${turns()}):\n${old ? JSON.stringify(compact(old)) : 'none — create the world from scratch'}\n`;
        if (note) p += `\nNOTE: ${note}\n`;
        p += full ? '\nThe recent chat is the conversation above.\n'
                  : `\nRECENT CHAT:\n${recent(old ? 8 : 6, 1100)}\n`;

        p += `
TASK: ${old ? 'Update' : 'Create'} the living state of the world from the story.
RULES:
- stats: 3-4 meters of the character's feelings and attitude toward the player (for example affection, trust, plus 1 story-specific one). Values 0-100. They change gradually (usually 0-8 per update), more only after major events. Keep the same stat names between updates.
- thought, shows, hides, mood, wants must reflect the LAST messages. thought is first person, in the character's voice, without quotation marks. mood.emoji is exactly one emoji.
- dream, loves, fears are durable traits: copy the previous values and change them only when the story reveals something new. loves up to 4, fears up to 3.
- judge feelings by ACTIONS, not words: if the character says one thing and does another, do not raise the stat, show the contradiction in "shows" and "hides". A good scene is not an automatic romantic breakthrough, stats may also fall.
- where: the character's location and activity in the latest scene. "next" comes from his/her plans.
- agenda: 3-6 active AFFAIRS OF THE CHARACTER'S OWN LIFE (duty, work, family, politics, a hobby, a secret project, errands, meetings with others). They are NOT quests for the player and never require the player; involves_player = true only if the player is part of it right now. Write titles about the character's own business ("Закончить отчёт для совета", "Навестить сестру"). Progress moves gradually (usually 0-25 per update) because the world advances them offscreen; set "done" with progress 100 when finished, "dropped" if abandoned for a story reason. Replace finished affairs with new ones that grow out of the world. No rewards, no penalties. Keep ids stable. due_in_days = in-story days from today until the target day, or null.
- today: 3-5 slots of the character's plan for today (morning/day/evening/night), consistent with the affairs and the calendar. Update it when the story changes his/her plans. The character does not have to be next to the player all day: if his/her plan puts him/her elsewhere, say so.
${moduleRules()}- digest: only when the NOTE reports a time skip; otherwise an empty array.
- events: only NEW chronicle entries since the last update, max 4, one short line each (type hero, npc or world).
- memories: durable facts worth remembering 100 messages later; never repeat ones already listed.
- Do not invent facts that contradict the chat. No meta commentary.

JSON SHAPE:
${buildSchema()}`;
        return { system, prompt: p };
    }

    function variants(fn, objArgs, posArgs) {
        // в новых версиях ST функции принимают объект (fn.length === 0), в старых — позиционные аргументы
        const o = () => fn(objArgs);
        const p = () => fn(...posArgs);
        return fn.length === 0 ? [o, p] : [p, o];
    }

    async function callLLM(system, prompt, full) {
        const c = ctx();
        const LEN = 2500;

        // выбран отдельный профиль подключения: все запросы Системы идут через него (дешёвая модель)
        const pid = S().profileId;
        if (pid && c.ConnectionManagerRequestService) {
            try {
                const r = await c.ConnectionManagerRequestService.sendRequest(
                    pid,
                    [{ role: 'system', content: system }, { role: 'user', content: prompt }],
                    LEN,
                );
                const j = extractJson(r?.content || '');
                if (j) return j;
            } catch (e) {
                console.warn(`[${EXT}] profile request failed`, e);
                toast('Профиль подключения не ответил. Проверьте профиль в Connection Profile.', 'error', true);
            }
            return null; // осознанно без фолбэка, чтобы запрос не ушёл на дорогую основную модель
        }

        const list = [];
        if (full && typeof c.generateQuietPrompt === 'function') {
            const q = system + '\n\n' + prompt;
            list.push(...variants(c.generateQuietPrompt,
                { quietPrompt: q, skipWIAN: true, responseLength: LEN },
                [q, false, true, null, null, LEN]));
        } else if (typeof c.generateRaw === 'function') {
            list.push(...variants(c.generateRaw,
                { prompt, systemPrompt: system, responseLength: LEN },
                [prompt, null, false, false, system, LEN]));
        }
        for (const f of list) {
            try {
                const r = await f();
                const j = extractJson(typeof r === 'string' ? r : (r?.text || r?.content || ''));
                if (j) return j;
            } catch (e) {
                console.warn(`[${EXT}] generation attempt failed`, e);
            }
        }
        return null;
    }

    // ─── state ─────────────────────────────────────────────────────────────

    const LOG_TYPES = ['hero', 'npc', 'world'];
    const A_TYPES = ['duty', 'social', 'personal', 'project', 'secret'];
    const SLOTS = ['morning', 'day', 'evening', 'night'];
    const SLOT_RU = { morning: 'morning', day: 'daytime', evening: 'evening', night: 'night' };
    const N_STAT = ['active', 'away', 'gone'];
    // быт: ключ, значок, название, где хорошо (good = чем больше, тем лучше; bad = чем меньше, тем лучше)
    const NEEDS = [
        ['energy', '⚡', 'Энергия', 'good'], ['sleepy', '😴', 'Сонливость', 'bad'], ['satiety', '🍽️', 'Сытость', 'good'],
        ['appetite', '🍴', 'Голод', 'bad'], ['health', '🩺', 'Самочувствие', 'good'], ['happiness', '😊', 'Счастье', 'good'],
        ['stress', '😣', 'Стресс', 'bad'], ['desire', '🔥', 'Влечение', 'neutral'], ['social', '👥', 'Тяга к общению', 'neutral'],
    ];
    const needCrit = (kind, v) => (kind === 'good' ? v <= 20 : (kind === 'bad' ? v >= 80 : false));

    function normalize(raw, old, gap) {
        const t = turns();
        const arr = v => (Array.isArray(v) ? v : []);
        const list = (v, n) => arr(v).map(str).filter(Boolean).slice(0, n);
        const base = parseDMY(lastIB()?.date) ?? parseDMY(raw.calendar?.today) ?? old?.calendar?.day ?? null;

        const st = {
            v: 1,
            profile: str(raw.profile) || old?.profile || '',
            stage: str(raw.stage),
            mood: { emoji: str(raw.mood?.emoji) || '😐', label: str(raw.mood?.label) },
            thought: str(raw.thought),
            shows: str(raw.shows),
            hides: str(raw.hides),
            wants: str(raw.wants),
            dream: str(raw.dream) || old?.dream || '',
            loves: list(raw.loves, 4),
            fears: list(raw.fears, 3),
            ending: str(raw.ending),
            where: { place: str(raw.where?.place), doing: str(raw.where?.doing), with: str(raw.where?.with), next: str(raw.where?.next) },
            stats: [],
            agenda: [],
            today: [],
            npcs: old?.npcs || [],
            trends: old?.trends || [],
            log: old?.log ? [...old.log] : [],
            diary: old?.diary ? [...old.diary] : [],
            memories: old?.memories ? [...old.memories] : [],
            endings: old?.endings || [],
            calendar: old?.calendar || null,
            papers: old?.papers || [],
            away: old?.away || null,
            needs: old?.needs || null,
            bodyNote: old?.bodyNote || '',
            lastTurn: t,
            updatedAt: Date.now(),
        };
        if (!st.loves.length && old?.loves) st.loves = old.loves;
        if (!st.fears.length && old?.fears) st.fears = old.fears;

        st.stats = arr(raw.stats).slice(0, 5).map(x => {
            const name = str(x?.name);
            const value = clamp(Math.round(Number(x?.value)) || 0, 0, 100);
            const prev = old?.stats?.find(o => o.name.toLowerCase() === name.toLowerCase());
            return { name, icon: str(x?.icon) || '•', value, prev: prev ? prev.value : value };
        }).filter(x => x.name);

        // заморозка: чувства и мысли не трогаем, остальное обновляется
        if (S().frozen && old) {
            st.stats = old.stats.map(x => ({ ...x, prev: x.value }));
            st.stage = old.stage; st.mood = old.mood; st.thought = old.thought;
            st.shows = old.shows; st.hides = old.hides; st.wants = old.wants;
            st.dream = old.dream; st.loves = old.loves; st.fears = old.fears;
        }

        // дела героя
        const freshA = arr(raw.agenda).slice(0, 10).map((a, i) => {
            const id = str(a?.id) || ('a' + (i + 1));
            const o = old?.agenda?.find(x => x.id === id);
            const rin = a?.due_in_days;
            const din = (rin === null || rin === undefined || rin === '') ? NaN : Number(rin);
            let due = null;
            if (Number.isFinite(din)) due = base != null ? base + Math.round(din) : (o?.dueDay ?? null);
            const status = ['done', 'dropped'].includes(a?.status) ? a.status : 'active';
            return {
                id, type: A_TYPES.includes(a?.type) ? a.type : 'personal',
                title: str(a?.title), desc: str(a?.desc),
                progress: status === 'done' ? 100 : clamp(Math.round(Number(a?.progress)) || 0, 0, 100),
                dueDay: status === 'active' ? due : null, status, player: a?.involves_player === true,
                asked: o?.asked || false,
            };
        }).filter(a => a.title);
        const idsA = new Set(freshA.map(a => a.id));
        const histA = (old?.agenda || []).filter(a => a.status !== 'active' && !idsA.has(a.id));
        st.agenda = [...freshA.filter(a => a.status === 'active').slice(0, 6), ...[...freshA.filter(a => a.status !== 'active'), ...histA].slice(0, 10)];

        st.today = arr(raw.today).slice(0, 6).map(x => ({ slot: SLOTS.includes(x?.slot) ? x.slot : 'day', title: str(x?.title), place: str(x?.place) })).filter(x => x.title);
        if (!st.today.length && old?.today) st.today = old.today;

        if (S().mWorld) {
            if (Array.isArray(raw.npcs)) {
                st.npcs = raw.npcs.slice(0, 8).map((n, i) => ({
                    id: str(n?.id) || ('n' + (i + 1)), name: str(n?.name), role: str(n?.role), doing: str(n?.doing), place: str(n?.place),
                    goal: str(n?.goal), attitude: str(n?.attitude), status: N_STAT.includes(n?.status) ? n.status : 'active',
                })).filter(n => n.name);
            }
            if (Array.isArray(raw.trends)) {
                st.trends = raw.trends.slice(0, 5).map((x, i) => {
                    const id = str(x?.id) || ('t' + (i + 1));
                    const name = str(x?.name);
                    const value = clamp(Math.round(Number(x?.value)) || 0, 0, 100);
                    const o = (old?.trends || []).find(y => y.id === id || y.name.toLowerCase() === name.toLowerCase());
                    return { id, name, icon: str(x?.icon) || '•', value, prev: o ? o.value : value, note: str(x?.note) };
                }).filter(x => x.name);
            }
        }

        if (S().mNeeds) {
            const rn = (raw.needs && typeof raw.needs === 'object') ? raw.needs : null;
            const needs = {};
            for (const [k] of NEEDS) {
                const o = old?.needs?.[k];
                const v = (rn && Number.isFinite(Number(rn[k]))) ? clamp(Math.round(Number(rn[k])), 0, 100) : (o ? o.value : 50);
                needs[k] = { value: v, prev: o ? o.value : v };
            }
            st.needs = needs;
            if (rn) st.bodyNote = str(raw.body_note);
        }

        const lines = list(raw.digest, 6);
        if (lines.length && gap >= 1) st.away = { turn: t, days: gap, lines };

        const events = arr(raw.events).slice(0, 4)
            .map(e => ({ turn: t, type: LOG_TYPES.includes(e?.type) ? e.type : 'world', text: str(e?.text) }))
            .filter(e => e.text);
        st.log = [...events, ...st.log].slice(0, 80);

        const d = str(raw.diary);
        if (d) st.diary = [{ turn: t, text: d }, ...st.diary].slice(0, 40);

        const known = new Set(st.memories.map(m => m.text.toLowerCase()));
        for (const m of list(raw.memories, 3)) {
            if (!known.has(m.toLowerCase())) { st.memories.unshift({ turn: t, text: m }); known.add(m.toLowerCase()); }
        }
        st.memories = st.memories.slice(0, 40);

        if (S().mEnd && Array.isArray(raw.endings) && raw.endings.length) {
            st.endings = raw.endings.slice(0, 5).map((e, i) => ({
                id: str(e?.id) || ('e' + (i + 1)),
                kind: ['good', 'neutral', 'bad', 'true'].includes(e?.kind) ? e.kind : 'neutral',
                title: str(e?.title), hint: str(e?.hint),
                progress: clamp(Math.round(Number(e?.progress)) || 0, 0, 100),
                revealed: e?.revealed !== false,
            })).filter(e => e.title);
        }

        if (S().mCal && raw.calendar && typeof raw.calendar === 'object') {
            const rc = raw.calendar;
            const oldEv = old?.calendar?.events || [];
            const E_TYPES = ['ball', 'meeting', 'duty', 'trip', 'holiday', 'deadline', 'market', 'other'];
            const evs = arr(rc.events).slice(0, 10).map((e, i) => {
                const id = str(e?.id) || ('c' + (i + 1));
                const o = oldEv.find(x => x.id === id);
                const inDays = Number(e?.in_days);
                let day = o?.day ?? null;
                if (base != null && Number.isFinite(inDays)) day = base + Math.round(inDays);
                const status = ['done', 'cancelled'].includes(e?.status) ? e.status : 'upcoming';
                if (o && o.status === 'upcoming' && status === 'done') st.log.unshift({ turn: t, type: 'world', text: `Состоялось: «${str(e?.title) || o.title}»` });
                if (o && o.status === 'upcoming' && status === 'cancelled') st.log.unshift({ turn: t, type: 'world', text: `Не состоялось: «${str(e?.title) || o.title}»` });
                return {
                    id, title: str(e?.title), type: E_TYPES.includes(e?.type) ? e.type : 'other', day,
                    time: str(e?.time), place: str(e?.place), note: str(e?.note), agenda: str(e?.agenda), status,
                    reminded: o?.reminded || false, todayNotified: o?.todayNotified || false, asked: o?.asked || false,
                };
            }).filter(e => e.title);
            const ids = new Set(evs.map(e => e.id));
            const resolvedOld = oldEv.filter(e => e.status !== 'upcoming' && !ids.has(e.id));
            const upcoming = evs.filter(e => e.status === 'upcoming').slice(0, 8);
            const resolved = [...evs.filter(e => e.status !== 'upcoming'), ...resolvedOld].slice(0, 8);
            st.calendar = { today: str(rc.today), day: base, events: [...upcoming, ...resolved] };
            st.log = st.log.slice(0, 80);
        }

        return st;
    }

    function applyInjection() {
        const c = ctx();
        const s = S();
        const st = getState();
        try {
            if (!s.enabled || !s.inject || !st) {
                c.setExtensionPrompt(EXT, '', 1, 1);
                return;
            }
            const name = focusName();
            const un = c.name1 || 'the player';
            const stats = st.stats.map(x => `${x.name} ${x.value}/100`).join(', ');
            const w = st.where || {};
            const loc = (w.place || w.doing) ? ` Right now: ${[w.place, w.doing].filter(Boolean).join(', ')}${w.with ? ' (with ' + w.with + ')' : ''}.${w.next ? ' Next: ' + w.next + '.' : ''}` : '';
            const plan = st.today.length ? ` Plan for today: ${st.today.map(x => `${SLOT_RU[x.slot] || x.slot}: ${x.title}${x.place ? ' @ ' + x.place : ''}`).join('; ')}.` : '';
            const aff = st.agenda.filter(a => a.status === 'active').slice(0, 3).map(a => a.title).join('; ');
            const now = nowDay(st);
            const soon = (s.mCal && now != null) ? (st.calendar?.events || [])
                .filter(e => e.status === 'upcoming' && e.day != null && e.day - now >= 0 && e.day - now <= 7)
                .sort((a, b) => a.day - b.day).slice(0, 3) : [];
            const cal = soon.length ? ` Calendar: ${soon.map(e => `${e.title} (${rel(e.day, now)})`).join('; ')}.` : '';
            let world = '';
            if (s.mWorld) {
                const npcs = (st.npcs || []).filter(n => n.status === 'active').slice(0, 3).map(n => `${n.name} — ${n.doing}${n.place ? ' (' + n.place + ')' : ''}`).join('; ');
                const tr = (st.trends || []).filter(x => x.value <= 30 || x.value >= 70).slice(0, 2).map(x => `${x.name} ${x.value}/100`).join(', ');
                world = `${npcs ? ` Around: ${npcs}.` : ''}${tr ? ` World: ${tr}.` : ''}`;
            }
            let body = '';
            if (s.mNeeds && st.needs) {
                const v = k => st.needs[k]?.value;
                const n = [];
                if (v('energy') <= 25) n.push('exhausted');
                if (v('sleepy') >= 75) n.push('very sleepy');
                if (v('satiety') <= 25 || v('appetite') >= 75) n.push('hungry');
                if (v('stress') >= 75) n.push('stressed');
                if (v('health') <= 40) n.push('unwell');
                if (v('happiness') <= 25) n.push('unhappy');
                if (v('desire') >= 65) n.push(`strongly drawn to ${un} (let it show subtly in tone and glances, never explicit unless the scene already goes there)`);
                const all = [...n, st.bodyNote].filter(Boolean);
                if (all.length) body = ` Physical and emotional state: ${all.join('; ')}.`;
            }
            const txt = `[Hidden world state. Never mention it, the numbers or any "system" in the text — just let it quietly steer ${name}'s behavior and the world around. Relationship stage with ${un}: ${st.stage}. Mood: ${st.mood.label}. Outwardly: ${st.shows}. Secretly: ${st.hides}. Wants: ${st.wants}. ${stats}.${loc}${plan}${aff ? ` Own affairs: ${aff}.` : ''}${cal}${world}${body} ${name} and the world have their own life: ${name} may be busy, late or elsewhere according to the plans, and other characters act on their own goals; do not make everyone revolve around ${un}.]`;
            c.setExtensionPrompt(EXT, txt, 1, 1);
        } catch (e) {
            console.warn(`[${EXT}] inject failed`, e);
        }
    }

    // ─── update ────────────────────────────────────────────────────────────

    let busy = false;
    let unseen = false;
    let skipTried = null;

    const snapshot = x => { const c = JSON.parse(JSON.stringify(x)); delete c.prev; return c; };

    async function runUpdate(opts = {}) {
        if (busy) return false;
        if (!focusChar()) {
            toast(isGroup() ? 'Выберите героя в верхней части окна.' : 'Откройте чат с персонажем, чтобы создать мир.', 'warning', true);
            return false;
        }
        busy = true;
        setBusyUI(true);
        try {
            const old = opts.fresh ? null : getState();
            const gap = old ? gapDays(old) : 0;
            const note = [opts.note, overdueNote(old), old ? skipNote(old) : ''].filter(Boolean).join(' ');
            const { system, prompt } = buildPrompts(old, S().fullPreset, note);
            const raw = await callLLM(system, prompt, S().fullPreset);
            if (!raw) {
                toast('Не удалось получить ответ модели. Проверьте API или выключите режим полного пресета.', 'error', true);
                return false;
            }
            const st = normalize(raw, old, gap >= 2 ? gap : 0);
            const cur = getState();
            st.prev = cur ? snapshot(cur) : null;
            setState(st);
            applyInjection();
            announce(old, st);
            if (!isOpen()) { unseen = true; updateFabDot(); }
            render();
            return true;
        } catch (e) {
            console.error(`[${EXT}]`, e);
            toast('Ошибка обновления мира, подробности в консоли.', 'error', true);
            return false;
        } finally {
            busy = false;
            setBusyUI(false);
        }
    }

    function onMessage() {
        const s = S();
        if (!s.enabled) return;
        const st = getState();
        if (!st) { render(); return; }
        const t = turns();

        let due = false;
        const nowD = nowDay(st);

        // календарь: напоминания и просроченные события
        if (s.mCal && st.calendar?.events?.length && nowD != null) {
            let changed = false;
            for (const e of st.calendar.events) {
                if (e.status !== 'upcoming' || e.day == null) continue;
                const k = e.day - nowD;
                if (k < 0) {
                    if (!e.asked) { e.asked = true; changed = true; due = true; }
                } else if (k === 0 && !e.todayNotified) {
                    e.todayNotified = true;
                    changed = true;
                    popup('event', e.title, 'Сегодня в календаре!');
                } else if (k > 0 && k <= 2 && !e.reminded) {
                    e.reminded = true;
                    changed = true;
                    popup('event', `${e.title} · ${rel(e.day, nowD)}`, 'Скоро событие');
                }
            }
            if (changed) {
                setState(st);
                if (!isOpen()) { unseen = true; updateFabDot(); }
            }
        }

        // дела с датой: когда срок прошёл, просим подвести итог
        if (nowD != null) {
            let aChanged = false;
            for (const a of st.agenda) {
                if (a.status === 'active' && a.dueDay != null && a.dueDay < nowD && !a.asked) {
                    a.asked = true;
                    aChanged = true;
                    due = true;
                }
            }
            if (aChanged) {
                setState(st);
                if (!isOpen()) { unseen = true; updateFabDot(); }
            }
        }

        // скачок времени в истории: мир надо «прокрутить»
        if (s.mCal && nowD != null && gapDays(st) >= 2 && skipTried !== nowD) {
            skipTried = nowD;
            due = true;
        }

        if (s.auto && (due || t - (st.lastTurn || 0) >= s.every)) {
            setTimeout(() => runUpdate(), 700);
        } else {
            render();
        }
    }

    function buildPaperPrompts(st, full) {
        const c = ctx();
        const cn = focusName();
        const un = c.name1 || 'User';
        const system = `You are the editor of the gossip newspaper of this story's world. You write the latest issue. Reply with ONE valid JSON object only: no markdown, no text outside the JSON. All text values in Russian.`;
        const prevTitles = (st.papers || []).slice(0, 2).flatMap(p => p.headlines.map(h => h.title)).join(' | ');
        let p = `CHARACTER PROFILE (${cn}): ${st.profile || ''}\n`;
        p += `PLAYER PERSONA: ${un}\nRELATIONSHIP STAGE: ${st.stage}\n`;
        const nd = nowDay(st);
        if (nd != null) p += `IN-STORY DATE: ${fmtFull(nd)}, ${seasonOf(fmtFull(nd))[1]}\n`;
        p += `HERO'S AFFAIRS: ${st.agenda.filter(a => a.status === 'active').map(a => a.title).join('; ') || 'none'}\n`;
        if (st.npcs?.length) p += `NPCS: ${st.npcs.map(n => `${n.name} (${n.role}): ${n.doing}`).join('; ')}\n`;
        if (st.trends?.length) p += `WORLD TRENDS: ${st.trends.map(x => `${x.name} ${x.value}/100`).join('; ')}\n`;
        if (st.away?.lines?.length) p += `RECENTLY (while the player was away): ${st.away.lines.join(' ')}\n`;
        if (prevTitles) p += `ALREADY PRINTED (do not repeat): ${prevTitles}\n`;
        if (S().extra.trim()) p += `PLAYER'S WISHES: ${S().extra.trim()}\n`;
        p += full ? '\nThe recent chat is the conversation above.\n' : `\nRECENT CHAT:\n${recent(6, 900)}\n`;
        p += `
TASK: write a new issue of the gossip paper.
RULES:
- 5-6 items. At least 3 are about the wider world and have NOTHING to do with the protagonists: politics, borders and war, the economy, weather, crime, fashion, culture, other noble houses or other circles of this setting.
- 1-2 items are gossip about ${un} and ${cn}, based ONLY on what could plausibly have been witnessed in the recent chat. Gossip may be exaggerated or distorted (truth "rumor" or "scandal"); world news is "fact".
- Draw on the world state: NPC affairs, trend shifts and the hero's own affairs may appear as news or gossip.
- Everything must fit the setting and not contradict the chat or the profile. The paper's name, tone and sections must feel native to this world.
- Short: each text is 1-3 sentences. End with one tiny funny classified ad. Nothing explicit.

JSON SHAPE:
{"paper": "<name of the newspaper>", "date": "<date of the issue in the world's style or empty>", "headlines": [{"section": "<section name>", "title": "<headline>", "text": "<1-3 sentences>", "truth": "fact|rumor|scandal"}], "ad": "<classified ad>"}`;
        return { system, prompt: p };
    }

    async function runPaper() {
        if (busy) return;
        const st = getState();
        if (!st) return;
        busy = true;
        setBusyUI(true);
        try {
            const { system, prompt } = buildPaperPrompts(st, S().fullPreset);
            const raw = await callLLM(system, prompt, S().fullPreset);
            if (!raw || !Array.isArray(raw.headlines) || !raw.headlines.length) {
                toast('Газета не вышла: модель не вернула номер. Попробуйте ещё раз.', 'error', true);
                return;
            }
            const issue = {
                turn: turns(), paper: str(raw.paper), date: str(raw.date), ad: str(raw.ad),
                headlines: raw.headlines.slice(0, 7).map(h => ({
                    section: str(h?.section) || 'Новости', title: str(h?.title), text: str(h?.text),
                    truth: ['fact', 'rumor', 'scandal'].includes(h?.truth) ? h.truth : 'rumor',
                })).filter(h => h.title),
            };
            const cur = getState() || st;
            cur.papers = [issue, ...(cur.papers || [])].slice(0, 6);
            setState(cur);
            paperIdx = 0;
            popup('news', issue.paper || 'Свежий номер', 'Вышел свежий номер!');
            render();
        } catch (e) {
            console.error(`[${EXT}]`, e);
            toast('Ошибка выпуска газеты, подробности в консоли.', 'error', true);
        } finally {
            busy = false;
            setBusyUI(false);
        }
    }

    // ─── UI ────────────────────────────────────────────────────────────────

    let tab = 'status';
    const isOpen = () => { const m = document.getElementById('lw-modal'); return !!m && !m.classList.contains('lw-hidden'); };

    function setBusyUI(v) {
        document.getElementById('lw-modal')?.classList.toggle('lw-busy', v);
        document.getElementById('lw-fab')?.classList.toggle('busy', v);
    }
    function updateFabDot() { document.getElementById('lw-fab')?.classList.toggle('dot', unseen); }

    function section(title) { return `<div class="lw-sec">${title}</div>`; }

    // время суток по инфоблоку (если есть)
    function nowSlot() {
        const m = String(lastIB()?.time || '').match(/(\d{1,2})[:.](\d{2})/);
        if (!m) return null;
        const h = Number(m[1]);
        return h >= 5 && h < 11 ? 'morning' : (h >= 11 && h < 17 ? 'day' : (h >= 17 && h < 22 ? 'evening' : 'night'));
    }

    const SLOT_LBL = { morning: '🌅 Утро', day: '☀️ День', evening: '🌆 Вечер', night: '🌙 Ночь' };
    const A_LABEL = { duty: 'ДОЛГ', social: 'ВСТРЕЧИ', personal: 'ЛИЧНОЕ', project: 'ПРОЕКТ', secret: 'СЕКРЕТ' };
    const N_LABEL = { active: '', away: 'в отъезде', gone: 'выбыл(а)' };

    function emptyView() {
        const gi = groupInfo();
        if (gi && !focusKey()) {
            return `<div class="lw-empty"><div class="lw-big">✦</div><div class="lw-etitle">Выберите героя</div>
                <div class="lw-edesc">Это групповой чат. Мир строится вокруг одного героя за раз, переключаться можно в любой момент, у каждого свой прогресс.</div>
                <div class="lw-choices" style="width:100%">${gi.members.map(m => `<button class="lw-choice" data-act="hero" data-av="${esc(m.avatar)}">${esc(m.name)}</button>`).join('')}</div></div>`;
        }
        return `<div class="lw-empty">
            <div class="lw-big">✦</div>
            <div class="lw-etitle">Мир не создан</div>
            <div class="lw-edesc">Он прочитает карточку персонажа и вашу историю: заполнит состояние героя, его расписание и дела, жителей вокруг и тренды мира.</div>
            <button class="lw-btn lw-primary" data-act="init">✨ Создать мир</button>
        </div>`;
    }

    function ago(ts) {
        const m = Math.round((Date.now() - ts) / 60000);
        if (m < 1) return 'только что';
        if (m < 60) return `${m} мин назад`;
        const h = Math.round(m / 60);
        return h < 24 ? `${h} ч назад` : `${Math.round(h / 24)} дн назад`;
    }

    function portrait() {
        const c = ctx();
        const ch = focusChar();
        if (!ch?.avatar) return '<div class="lw-portrait-wrap"><span class="lw-noimg">✦</span></div>';
        let url = `/thumbnail?type=avatar&file=${encodeURIComponent(ch.avatar)}`;
        try { if (typeof c.getThumbnailUrl === 'function') url = c.getThumbnailUrl('avatar', ch.avatar) || url; } catch (e) { /* запасной адрес */ }
        return `<div class="lw-portrait-wrap"><span class="lw-noimg">✦</span><img class="lw-portrait" src="${esc(url)}" alt=""></div>`;
    }

    function viewStatus(st) {
        if (!st) return emptyView();
        const name = esc(focusName());
        const stats = st.stats.map(x => {
            const d = x.value - x.prev;
            const dh = d ? `<em class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</em>` : '';
            return `<div class="lw-stat">
                <div class="lw-srow"><span>${esc(x.icon)} ${esc(x.name)}</span><b>${num(x.value)}${dh}</b></div>
                <div class="lw-bar"><i style="width:${pct(x.value)}%"></i></div>
            </div>`;
        }).join('');
        const w = st.where || {};
        const where = (w.place || w.doing) ? `<div class="lw-where"><small>Сейчас</small>${w.place ? `<b>📍 ${esc(w.place)}</b>` : ''}<span>${esc(w.doing)}</span>${w.with ? `<em>рядом: ${esc(w.with)}</em>` : ''}${w.next ? `<i>дальше: ${esc(w.next)}</i>` : ''}</div>` : '';
        const tags = (arr, ico) => arr.map(x => `<span class="lw-tag">${ico} ${esc(x)}</span>`).join('');
        return `
            <div class="lw-mood">
                ${portrait()}
                <div class="lw-mtext"><div class="lw-cname">${name}</div><div class="lw-mlabel">${esc(st.mood.emoji)} ${esc(st.mood.label)}</div><div class="lw-stage">${esc(st.stage)}</div></div>
            </div>
            ${where}
            <div class="lw-sec">Чувства</div>
            ${stats}
            <div class="lw-sec">Мысли</div>
            <div class="lw-thought">«${esc(st.thought)}»<small>— ${name}, про себя</small></div>
            <div class="lw-two">
                <div class="lw-mini"><small>Показывает</small>${esc(st.shows)}</div>
                <div class="lw-mini"><small>Скрывает</small>${esc(st.hides)}</div>
            </div>
            ${(st.dream || st.wants) ? `<div class="lw-two">
                ${st.dream ? `<div class="lw-mini"><small>Мечтает</small>${esc(st.dream)}</div>` : ''}
                ${st.wants ? `<div class="lw-mini"><small>Хочет сейчас</small>${esc(st.wants)}</div>` : ''}
            </div>` : ''}
            ${(st.loves.length || st.fears.length) ? `<div class="lw-sec">Любит и не любит</div><div class="lw-tags">${tags(st.loves, '💗')}${tags(st.fears, '🌑')}</div>` : ''}
            ${st.ending ? `<div class="lw-sec">Куда всё идёт</div><div class="lw-ending">${esc(st.ending)}</div>` : ''}
            <div class="lw-foot"><span>Обновлено: ${ago(st.updatedAt)}</span><button class="lw-btn" data-act="update">🔄 Обновить</button></div>`;
    }

    const NEED_GROUPS = [['Тело', ['energy', 'sleepy', 'satiety', 'appetite', 'health']], ['Душа', ['happiness', 'stress', 'desire', 'social']]];

    function viewNeeds(st) {
        if (!st) return emptyView();
        if (!S().mNeeds) return '<div class="lw-none">Быт выключен в настройках.</div>';
        if (!st.needs) return `<div class="lw-empty"><div class="lw-big">🍽️</div><div class="lw-etitle">Быт героя</div><div class="lw-edesc">Энергия, сон, еда, самочувствие, счастье, стресс, влечение. Заполнится при ближайшем обновлении.</div><button class="lw-btn lw-primary" data-act="update">🔄 Обновить</button></div>`;
        const meta = Object.fromEntries(NEEDS.map(n => [n[0], n]));
        const row = k => {
            const [, ic, label, kind] = meta[k];
            const o = st.needs[k];
            if (!o) return '';
            const d = o.value - o.prev;
            const dh = d ? `<em class="${(d > 0) === (kind !== 'bad') ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</em>` : '';
            return `<div class="lw-stat"><div class="lw-srow"><span>${ic} ${label}</span><b>${pct(o.value)}%${dh}</b></div><div class="lw-bar${needCrit(kind, o.value) ? ' crit' : ''}"><i style="width:${pct(o.value)}%"></i></div></div>`;
        };
        return `${st.bodyNote ? `<div class="lw-bnote">${esc(st.bodyNote)}</div>` : ''}
            ${NEED_GROUPS.map(([title, keys]) => section(title) + keys.map(row).join('')).join('')}
            <div class="lw-foot"><span>Обновлено: ${ago(st.updatedAt)}</span><button class="lw-btn" data-act="update">🔄 Обновить</button></div>`;
    }

    function viewAgenda(st) {
        if (!st) return emptyView();
        const now = nowDay(st);
        const cur = nowSlot();
        const plan = st.today.map(x => `<div class="lw-slot${x.slot === cur ? ' now' : ''}"><span>${SLOT_LBL[x.slot] || ''}</span><div><b>${esc(x.title)}</b>${x.place ? `<small>📍 ${esc(x.place)}</small>` : ''}</div></div>`).join('');
        const active = st.agenda.filter(a => a.status === 'active');
        const fin = st.agenda.filter(a => a.status !== 'active');
        const card = a => {
            const due = (a.dueDay != null && now != null) ? `📅 до ${fmtDay(a.dueDay)} · ${rel(a.dueDay, now)}` : '';
            const ev = (st.calendar?.events || []).filter(e => e.agenda === a.id && e.status === 'upcoming')
                .map(e => `<div class="lw-qev">📅 ${esc(e.title)}${e.day != null && now != null ? ' · ' + rel(e.day, now) : ''}</div>`).join('');
            return `<div class="lw-q lw-${cls(a.type)}">
                <div class="lw-qh"><span class="lw-chip">${A_LABEL[a.type] || 'ДЕЛО'}</span>${a.player ? '<span class="lw-ptag">с вашим участием</span>' : ''}${due ? `<span class="lw-due">${due}</span>` : ''}</div>
                <div class="lw-qt">${esc(a.title)}</div>
                <div class="lw-qd">${esc(a.desc)}</div>
                ${ev}
                <div class="lw-bar"><i style="width:${pct(a.progress)}%"></i></div>
                <div class="lw-prog">${pct(a.progress)}%</div>
            </div>`;
        };
        return `${section('Сегодня')}${plan || '<div class="lw-none">План дня ещё не составлен</div>'}
            ${section('Дела героя')}${active.map(card).join('') || '<div class="lw-none">Нет активных дел</div>'}
            ${fin.length ? section('Завершённые и отложенные') + fin.map(a => `<div class="lw-fin ${cls(a.status)}">${a.status === 'done' ? '✔' : '⏸'} ${esc(a.title)}</div>`).join('') : ''}
            <div class="lw-foot"><span>Обновлено: ${ago(st.updatedAt)}</span><button class="lw-btn" data-act="update">🔄 Обновить</button></div>`;
    }

    function viewWorld(st) {
        if (!st) return emptyView();
        if (!S().mWorld) return '<div class="lw-none">Жители и тренды выключены в настройках.</div>';
        const away = (st.away && st.away.lines?.length)
            ? `${section(`Пока вас не было${st.away.days ? ' · ' + num(st.away.days) + ' дн.' : ''}`)}<div class="lw-away">${st.away.lines.map(l => `<p>${esc(l)}</p>`).join('')}<small>ход ${num(st.away.turn)}</small></div>` : '';
        const npcs = st.npcs.map(n => `<div class="lw-npc${n.status !== 'active' ? ' off' : ''}">
            <div class="lw-nh"><b>${esc(n.name)}</b>${n.status !== 'active' ? `<span class="lw-ptag">${esc(N_LABEL[n.status] || '')}</span>` : ''}</div>
            <small class="lw-role">${esc(n.role)}</small>
            <div class="lw-nd">${esc(n.doing)}${n.place ? ` · 📍 ${esc(n.place)}` : ''}</div>
            ${n.goal ? `<div class="lw-ng">🎯 ${esc(n.goal)}</div>` : ''}
            ${n.attitude ? `<div class="lw-ng">💭 ${esc(n.attitude)}</div>` : ''}
        </div>`).join('');
        const trends = st.trends.map(x => {
            const d = x.value - x.prev;
            const dh = d ? `<em class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</em>` : '';
            return `<div class="lw-stat">
                <div class="lw-srow"><span>${esc(x.icon)} ${esc(x.name)}</span><b>${num(x.value)}${dh}</b></div>
                <div class="lw-bar"><i style="width:${pct(x.value)}%"></i></div>
                ${x.note ? `<small class="lw-tnote">${esc(x.note)}</small>` : ''}
            </div>`;
        }).join('');
        const none = '<div class="lw-none">Пока пусто. Нажмите «Обновить»</div>';
        return `${away}${section('Жители')}${npcs || none}${section('Тренды мира')}${trends || none}
            <div class="lw-foot"><span>Обновлено: ${ago(st.updatedAt)}</span><button class="lw-btn" data-act="update">🔄 Обновить</button></div>`;
    }

    // последняя строка локации из инфоблока [IB] в чате: дата, время, место, погода (бесплатно, без запросов)
    function lastIB() {
        const chat = ctx().chat || [];
        for (let i = chat.length - 1; i >= Math.max(0, chat.length - 8); i--) {
            const m = chat[i];
            if (!m || m.is_user) continue;
            const mm = String(m.mes || '').match(/\[IB\]([\s\S]*?)\[\/IB\]/i);
            if (!mm) continue;
            const line = mm[1].split('\n').map(x => x.trim()).find(x => /^L:/i.test(x));
            if (line) {
                const p = line.slice(2).split('|').map(x => x.trim());
                return { loc: p[0] || '', date: p[1] || '', time: p[2] || '', weather: p[3] || '' };
            }
        }
        return null;
    }

    function seasonOf(date, fallback) {
        const m = String(date || '').match(/\b(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})\b/);
        if (m) {
            const mon = Number(m[2]);
            if (mon === 12 || (mon >= 1 && mon <= 2)) return ['❄️', 'Зима'];
            if (mon >= 3 && mon <= 5) return ['🌸', 'Весна'];
            if (mon >= 6 && mon <= 8) return ['☀️', 'Лето'];
            if (mon >= 9 && mon <= 11) return ['🍂', 'Осень'];
        }
        const f = String(fallback || '');
        if (/зим|winter/i.test(f)) return ['❄️', 'Зима'];
        if (/весн|spring/i.test(f)) return ['🌸', 'Весна'];
        if (/лет[оа]|summer/i.test(f)) return ['☀️', 'Лето'];
        if (/осен|autumn|fall/i.test(f)) return ['🍂', 'Осень'];
        return ['✦', ''];
    }

    let calOff = 0;
    let calSel = null;
    const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    const EV_ICON = { ball: '💃', meeting: '🤝', duty: '🛡️', trip: '🧳', holiday: '🎉', deadline: '⏰', market: '🛒', other: '✦' };

    function viewCalendar(st) {
        if (!st) return emptyView();
        const events = st.calendar?.events || [];
        const now = nowDay(st);
        if (now == null || !events.length) {
            return `<div class="lw-empty"><div class="lw-big">📅</div><div class="lw-etitle">Календарь пуст</div><div class="lw-edesc">${S().mCal ? 'Мир спланирует ближайшие недели: праздники, ярмарки, балы, обязанности, поездки и сроки дел героя.' : 'Календарь выключен в настройках.'}</div>${S().mCal ? '<button class="lw-btn lw-primary" data-act="update">🔄 Составить календарь</button>' : ''}</div>`;
        }
        const { y, m, first, wd, dim } = monthGrid(now, calOff);
        const byDay = new Map();
        for (const e of events) {
            if (e.day == null) continue;
            if (!byDay.has(e.day)) byDay.set(e.day, []);
            byDay.get(e.day).push(e);
        }
        let cells = '';
        for (let i = 0; i < wd; i++) cells += '<div class="lw-cd empty"></div>';
        for (let d = 1; d <= dim; d++) {
            const day = first + d - 1;
            const list = byDay.get(day) || [];
            const dots = list.slice(0, 3).map(e => `<i class="${e.status === 'cancelled' ? 'bad' : (e.status === 'done' ? 'ok' : '')}"></i>`).join('');
            cells += `<button class="lw-cd${day === now ? ' today' : ''}${day === calSel ? ' sel' : ''}${list.length ? ' has' : ''}" data-act="calday" data-day="${day}">${d}<span class="lw-dots">${dots}</span></button>`;
        }
        const head = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map(x => `<div class="lw-cw">${x}</div>`).join('');
        const affairs = new Map(st.agenda.map(a => [a.id, a]));
        const row = e => {
            const k = (e.day != null) ? e.day - now : null;
            const over = e.status === 'upcoming' && k !== null && k < 0;
            const c = e.status === 'done' ? 'done' : (e.status === 'cancelled' ? 'missed' : (over ? 'over' : (k === 0 ? 'today' : '')));
            const a = e.agenda ? affairs.get(e.agenda) : null;
            const meta = [e.time, e.place, e.note].filter(Boolean).map(esc).join(' · ');
            const tags = a ? `<span class="lw-qlink">🔗 ${esc(a.title)}</span>` : '';
            const status = e.status === 'done' ? '✔ состоялось' : (e.status === 'cancelled' ? '✖ не состоялось' : (over ? '⏳ ждёт итогов' : rel(e.day, now)));
            return `<div class="lw-ev ${c}"><div class="lw-evd"><b>${e.day != null ? fmtDay(e.day) : '—'}</b><small>${status}</small></div><div class="lw-evb"><b>${EV_ICON[e.type] || '✦'} ${esc(e.title)}</b>${meta ? `<small>${meta}</small>` : ''}${tags ? `<div class="lw-evt">${tags}</div>` : ''}</div></div>`;
        };
        const shown = (calSel != null ? events.filter(e => e.day === calSel) : events).slice().sort((a, b) => (a.day ?? 1e9) - (b.day ?? 1e9));
        const up = shown.filter(e => e.status === 'upcoming');
        const res = shown.filter(e => e.status !== 'upcoming');
        const [se] = seasonOf(fmtFull(now), '');
        return `<div class="lw-calhead"><button class="lw-mini-btn" data-act="calprev">‹</button><div><b>${MONTHS[m]} ${y}</b><small>${se} сегодня ${fmtFull(now)}</small></div><button class="lw-mini-btn" data-act="calnext">›</button></div>
            <div class="lw-grid">${head}${cells}</div>
            ${calSel != null ? `<div class="lw-sec">События дня ${fmtDay(calSel)} <button class="lw-mini-btn" data-act="calclear">показать все</button></div>` : section('Предстоящее')}
            ${up.map(row).join('') || '<div class="lw-none">На этот день ничего не запланировано</div>'}
            ${res.length ? section('Прошедшее') + res.map(row).join('') : ''}
            <div class="lw-foot"><span>Дата берётся из инфоблока</span><button class="lw-btn" data-act="update">🔄 Обновить</button></div>`;
    }

    const LOG_ICON = { hero: '👤', npc: '🧑‍🤝‍🧑', world: '🌍' };

    function viewLog(st) {
        if (!st) return emptyView();
        const ev = st.log.slice(0, 30).map(e => `<div class="lw-log ${cls(e.type)}"><span>${LOG_ICON[e.type] || '✦'}</span><div>${esc(e.text)}<small>ход ${num(e.turn)}</small></div></div>`).join('');
        const mem = (st.memories || []).slice(0, 15).map(e => `<div class="lw-mem">${esc(e.text)}<small>ход ${num(e.turn)}</small></div>`).join('');
        const dia = (st.diary || []).slice(0, 10).map(e => `<div class="lw-dia">${esc(e.text)}<small>ход ${num(e.turn)}</small></div>`).join('');
        return `${section('Хроника мира')}${ev || '<div class="lw-none">Пока пусто</div>'}${mem ? section('Память: обещания, конфликты, секреты') + mem : ''}${dia ? section('Дневник героя') + dia : ''}`;
    }

    function viewSettings() {
        const s = S();
        const cur = getState();
        const profiles = ctx().extensionSettings?.connectionManager?.profiles || [];
        const chk = (k, label, hint = '') => `<label class="lw-row"><input type="checkbox" data-set="${k}" ${s[k] ? 'checked' : ''}><span>${label}${hint ? `<small>${hint}</small>` : ''}</span></label>`;
        return `
            ${chk('enabled', 'Расширение включено')}
            ${chk('auto', 'Автообновление', 'Отдельный запрос к модели раз в несколько ответов и при скачке времени в истории')}
            <label class="lw-row"><span>Обновлять каждые <input type="number" min="1" max="20" data-set="every" value="${num(s.every)}" class="lw-num"> ответов</span></label>
            ${chk('frozen', 'Заморозить чувства', 'Настроение, показатели и мысли не меняются. Дела, мир и календарь обновляются')}
            <label class="lw-row lw-sel"><span>Профиль подключения<small>Дешёвая модель для запросов расширения. Профили создаются в Connection Profile. Если выбран, «полный пресет» не используется</small></span><select data-set="profileId" class="lw-select"><option value="">Основное подключение</option>${profiles.map(p => `<option value="${esc(p.id)}" ${s.profileId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
            <label class="lw-row lw-sel"><span>Тема окна</span><select data-set="theme" class="lw-select">${[['pink', 'Розовая'], ['lavender', 'Лавандовая'], ['wine', 'Винная'], ['auto', 'От темы ST']].map(([v, l]) => `<option value="${v}" ${s.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            ${chk('cute', 'Милые всплывающие окна', 'Выключите, чтобы получать обычные окна таверны')}
            ${chk('mWorld', 'Живые NPC и тренды мира', 'Входят в обновления, добавляют токенов')}
            ${chk('mNeeds', 'Быт героя', 'Энергия, сон, еда, самочувствие, счастье, стресс, влечение. Входит в обновления, добавляет токенов')}
            ${chk('mEnd', 'Архив концовок')}
            ${chk('mCal', 'Календарь и скачки времени')}
            ${chk('inject', 'Подмешивать состояние в промпт', 'Герой и мир ведут себя по расписанию, настроению и делам (около 200 токенов)')}
            ${chk('notify', 'Всплывающие уведомления')}
            ${chk('floating', 'Плавающая кнопка на экране')}
            ${chk('fullPreset', 'Обновлять через полный пресет', 'Дороже по токенам, экспериментально. Нужно, если модель отказывается от обновлений без пресета')}
            <div class="lw-sec">Пожелания к миру</div>
            <textarea class="lw-ta" data-set="extra" rows="3" placeholder="Например: больше политики, у героя напряжённая служба, жизнь города поживее">${esc(s.extra)}</textarea>
            <div class="lw-foot2">
                <button class="lw-btn" data-act="rollback" ${cur?.prev ? '' : 'disabled'}>↩ Откатить</button>
                <button class="lw-btn" data-act="export" ${cur ? '' : 'disabled'}>⬇ Экспорт</button>
                <button class="lw-btn" data-act="import">⬆ Импорт</button>
                <input type="file" id="lw-file" accept="application/json,.json" hidden>
            </div>
            <div class="lw-foot2">
                <button class="lw-btn" data-act="recreate">♻ Пересоздать</button>
                <button class="lw-btn lw-danger" data-act="wipe">🗑 Стереть данные чата</button>
            </div>`;
    }

    function render() {
        const body = document.getElementById('lw-body');
        if (!body) return;
        const st = getState();
        const views = { status: viewStatus, needs: viewNeeds, agenda: viewAgenda, world: viewWorld, calendar: viewCalendar, news: viewNews, endings: viewEndings, log: viewLog };
        body.innerHTML = tab === 'settings' ? viewSettings() : (views[tab] || viewStatus)(st);
        document.querySelectorAll('#lw-modal .lw-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        const hb = document.getElementById('lw-heroes');
        if (hb) {
            const gi = groupInfo();
            if (!gi) { hb.innerHTML = ''; hb.style.display = 'none'; }
            else {
                hb.style.display = '';
                const fk = focusKey();
                hb.innerHTML = gi.members.map(m => `<button class="lw-hero${m.avatar === fk ? ' active' : ''}" data-act="hero" data-av="${esc(m.avatar)}">${esc(m.name)}</button>`).join('');
            }
        }
        const worldTab = document.querySelector('#lw-modal [data-tab="world"]');
        if (worldTab) worldTab.style.display = S().mWorld ? '' : 'none';
        const needsTab = document.querySelector('#lw-modal [data-tab="needs"]');
        if (needsTab) needsTab.style.display = S().mNeeds ? '' : 'none';
        const sub = document.getElementById('lw-sub');
        if (sub) sub.textContent = st ? focusName() : '';
    }

    function openPanel() {
        document.getElementById('lw-modal')?.classList.remove('lw-hidden');
        unseen = false;
        calOff = 0;
        calSel = null;
        updateFabDot();
        render();
    }
    function closePanel() { document.getElementById('lw-modal')?.classList.add('lw-hidden'); }

    function buildModal() {
        if (document.getElementById('lw-modal')) return;
        const m = document.createElement('div');
        m.id = 'lw-modal';
        m.className = 'lw-hidden';
        m.innerHTML = `
            <div class="lw-backdrop" data-act="close"></div>
            <div class="lw-window">
                <div class="lw-head">
                    <div class="lw-title">🌍 МИР <span id="lw-sub"></span><span class="lw-spin">⏳</span></div>
                    <button class="lw-x" data-act="close">✕</button>
                </div>
                <div class="lw-tabs">
                    <button class="lw-tab" data-tab="status">Герой</button>
                    <button class="lw-tab" data-tab="needs">Быт</button>
                    <button class="lw-tab" data-tab="agenda">Дела</button>
                    <button class="lw-tab" data-tab="world">Мир</button>
                    <button class="lw-tab" data-tab="calendar">Календарь</button>
                    <button class="lw-tab" data-tab="news">Газета</button>
                    <button class="lw-tab" data-tab="endings">Концовки</button>
                    <button class="lw-tab" data-tab="log">Журнал</button>
                    <button class="lw-tab" data-tab="settings">⚙</button>
                </div>
                <div class="lw-heroes" id="lw-heroes" style="display:none"></div>
                <div class="lw-body" id="lw-body"></div>
            </div>`;
        document.body.appendChild(m);

        // если аватарка не загрузилась, остаётся значок ✦ (без inline-JS в разметке)
        m.addEventListener('error', e => {
            if (e.target?.classList?.contains('lw-portrait')) e.target.remove();
        }, true);

        m.addEventListener('click', async e => {
            const tabBtn = e.target.closest('[data-tab]');
            if (tabBtn) { tab = tabBtn.dataset.tab; render(); return; }
            const el = e.target.closest('[data-act]');
            if (!el) return;
            const act = el.dataset.act;
            if (act === 'close') closePanel();
            else if (act === 'init' || act === 'update') await runUpdate();
            else if (act === 'hero') setFocus(el.dataset.av);
            else if (act === 'calprev') { calOff--; render(); }
            else if (act === 'calnext') { calOff++; render(); }
            else if (act === 'calday') {
                const d = Number(el.dataset.day);
                calSel = (calSel === d) ? null : d;
                render();
            } else if (act === 'calclear') { calSel = null; render(); }
            else if (act === 'paper') await runPaper();
            else if (act === 'pprev') { paperIdx++; render(); }
            else if (act === 'pnext') { paperIdx = Math.max(0, paperIdx - 1); render(); }
            else if (act === 'news') {
                const pp = getState()?.papers?.[Number(el.dataset.i)];
                const h = pp?.headlines?.[Number(el.dataset.j)];
                const ta = document.getElementById('send_textarea');
                if (h && ta) {
                    ta.value = `Я читаю «${pp.paper || 'газету'}»: ${h.title}. ${h.text}`;
                    ta.dispatchEvent(new Event('input', { bubbles: true }));
                    closePanel();
                    ta.focus();
                }
            } else if (act === 'rollback') {
                const cur = getState();
                if (cur?.prev) {
                    const restored = JSON.parse(JSON.stringify(cur.prev));
                    restored.prev = snapshot(cur);
                    setState(restored);
                    applyInjection();
                    render();
                    toast('Предыдущее состояние восстановлено', 'success', true);
                }
            } else if (act === 'export') {
                const blob = new Blob([JSON.stringify({ format: 'LIVING_WORLD', v: 1, state: getState() }, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = `living-world-${Date.now()}.json`; a.click();
                URL.revokeObjectURL(url);
            } else if (act === 'import') {
                document.getElementById('lw-file')?.click();
            } else if (act === 'recreate') {
                if (confirm('Пересоздать мир с нуля? Хроника, дневник, газета, жители и тренды этого чата будут стёрты.')) {
                    await runUpdate({ fresh: true });
                }
            } else if (act === 'wipe') {
                if (confirm('Удалить все данные мира в этом чате?')) {
                    setState(null);
                    applyInjection();
                    render();
                }
            }
        });

        m.addEventListener('change', async e => {
            if (e.target.id === 'lw-file') {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                    const data = JSON.parse(await f.text());
                    const st = data.state || data;
                    if (!st || !Array.isArray(st.stats) || !Array.isArray(st.agenda)) throw new Error('это не файл «Живого мира»');
                    st.prev = null;
                    setState(st);
                    applyInjection();
                    render();
                    toast('Состояние импортировано', 'success', true);
                } catch (err) {
                    toast('Не удалось импортировать: ' + err.message, 'error', true);
                }
                e.target.value = '';
                return;
            }
            const el = e.target.closest('[data-set]');
            if (!el) return;
            const s = S();
            const k = el.dataset.set;
            if (el.type === 'checkbox') s[k] = el.checked;
            else if (el.type === 'number') s[k] = clamp(Math.round(Number(el.value)) || DEFAULTS[k], 1, 20);
            else s[k] = el.value;
            saveS();
            applyTheme();
            applyFloating();
            applyInjection();
            render();
        });
    }

    let paperIdx = 0;
    const TRUTH = { fact: 'ФАКТ', rumor: 'СЛУХ', scandal: 'СКАНДАЛ' };

    function viewNews(st) {
        if (!st) return emptyView();
        const papers = st.papers || [];
        const btn = '<button class="lw-btn lw-primary" data-act="paper">📰 Выпустить свежий номер</button>';
        if (!papers.length) {
            return `<div class="lw-empty"><div class="lw-big">📰</div><div class="lw-etitle">Сплетник</div><div class="lw-edesc">Газета этого мира: новости двора, армии и города плюс слухи о вас. Выходит только по вашему запросу.</div>${btn}</div>`;
        }
        paperIdx = Math.min(Math.max(0, paperIdx), papers.length - 1);
        const p = papers[paperIdx];
        const items = p.headlines.map((h, j) => `<article class="lw-news ${esc(h.truth)}">
            <div class="lw-nh"><span class="lw-sectag">${esc(h.section)}</span><span class="lw-truth ${esc(h.truth)}">${TRUTH[h.truth] || 'СЛУХ'}</span></div>
            <h4>${esc(h.title)}</h4><p>${esc(h.text)}</p>
            <button class="lw-mini-btn" data-act="news" data-i="${paperIdx}" data-j="${j}">➜ в сюжет</button></article>`).join('');
        return `<div class="lw-paper">
            <div class="lw-mast">${esc(p.paper || 'Вестник')}</div>
            <div class="lw-issue">${esc(p.date || '')}${p.date ? ' · ' : ''}ход ${num(p.turn)}</div>
            ${items}${p.ad ? `<div class="lw-ad">${esc(p.ad)}</div>` : ''}
            </div>
            <div class="lw-pager"><button class="lw-mini-btn" data-act="pprev" ${paperIdx >= papers.length - 1 ? 'disabled' : ''}>‹ раньше</button><span>${paperIdx + 1} / ${papers.length}</span><button class="lw-mini-btn" data-act="pnext" ${paperIdx <= 0 ? 'disabled' : ''}>новее ›</button></div>
            <div class="lw-foot2">${btn}</div>`;
    }

    const KIND = { good: 'ХОРОШАЯ', neutral: 'НЕЙТРАЛЬНАЯ', bad: 'ПЛОХАЯ', true: 'ИСТИННАЯ' };

    function viewEndings(st) {
        if (!st) return emptyView();
        const list = [...(st.endings || [])].sort((a, b) => b.progress - a.progress);
        if (!list.length) return `<div class="lw-none">${st.ending ? esc(st.ending) : 'Направления появятся после обновления Системы.'}</div>`;
        return list.map(e => e.revealed
            ? `<div class="lw-end ${cls(e.kind)}"><div class="lw-qh"><span class="lw-chip">${KIND[e.kind]}</span><span class="lw-due">${pct(e.progress)}%</span></div><div class="lw-qt">${esc(e.title)}</div><div class="lw-qd">${esc(e.hint)}</div><div class="lw-bar"><i style="width:${pct(e.progress)}%"></i></div></div>`
            : `<div class="lw-end lw-locked"><div class="lw-qh"><span class="lw-chip">${KIND[e.kind]}</span></div><div class="lw-qt">🔒 ???</div><div class="lw-qd">Эта концовка ещё не открыта</div></div>`).join('')
            + '<div class="lw-hint">Это тенденции, а не жёсткие сценарии: история может свернуть куда угодно.</div>';
    }

    // ─── кнопки запуска ────────────────────────────────────────────────────

    function injectMenuItem() {
        if (document.getElementById('lw-menu-item')) return;
        const menu = document.getElementById('extensionsMenu');
        if (!menu) return;
        const item = document.createElement('div');
        item.id = 'lw-menu-item';
        item.className = 'list-group-item flex-container flexGap5';
        item.innerHTML = '<div class="fa-solid fa-earth-europe extensionsMenuExtensionButton"></div><span>Живой мир</span>';
        item.addEventListener('click', openPanel);
        menu.appendChild(item);
    }

    function applyTheme() {
        document.documentElement.dataset.lwTheme = S().theme || 'pink';
    }

    function applyFloating() {
        const s = S();
        let fab = document.getElementById('lw-fab');
        if (!s.floating || !s.enabled) { fab?.remove(); return; }
        if (fab) return;

        const SIZE = 46;
        fab = document.createElement('div');
        fab.id = 'lw-fab';
        fab.className = 'lw-fab';
        fab.title = 'Живой мир';
        fab.textContent = '🌍';
        document.body.appendChild(fab);

        const place = (x, y) => {
            fab.style.left = clamp(x, 0, window.innerWidth - SIZE) + 'px';
            fab.style.top = clamp(y, 0, window.innerHeight - SIZE) + 'px';
        };
        const pos = s.pos || { x: window.innerWidth - SIZE - 12, y: window.innerHeight - 290 };
        place(pos.x, pos.y);
        window.addEventListener('resize', () => place(fab.offsetLeft, fab.offsetTop));
        updateFabDot();

        let drag = null;
        fab.addEventListener('pointerdown', e => {
            drag = { sx: e.clientX, sy: e.clientY, bx: fab.offsetLeft, by: fab.offsetTop, moved: false };
            fab.setPointerCapture(e.pointerId);
        });
        fab.addEventListener('pointermove', e => {
            if (!drag) return;
            const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
            if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
            if (drag.moved) place(drag.bx + dx, drag.by + dy);
        });
        fab.addEventListener('pointerup', () => {
            if (!drag) return;
            if (drag.moved) { S().pos = { x: fab.offsetLeft, y: fab.offsetTop }; saveS(); }
            else openPanel();
            drag = null;
        });
        fab.addEventListener('pointercancel', () => { drag = null; });
    }

    // ─── init ──────────────────────────────────────────────────────────────

    jQuery(async () => {
        const { eventSource, event_types } = ctx();
        applyTheme();
        buildModal();
        injectMenuItem();
        applyFloating();
        applyInjection();

        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onMessage);
        eventSource.on(event_types.CHAT_CHANGED, () => {
            unseen = false;
            updateFabDot();
            applyInjection();
            render();
        });
        console.log(`[${EXT}] loaded`);
    });
})();
