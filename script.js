'use strict';

// === STORE ===
const Store = {
    get(k, d) {
        try {
            const v = localStorage.getItem('schedule_app_' + k);
            return v !== null ? JSON.parse(v) : d;
        } catch {
            return d;
        }
    },
    set(k, v) {
        localStorage.setItem('schedule_app_' + k, JSON.stringify(v));
    }
};

// === PARSER ===
const ScheduleParser = {
    parseSemester(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        let table = doc.querySelector('#schedule_table_och_sem .schedule_table table') || 
                    doc.querySelector('#schedule_table_och_sem table') || 
                    doc.querySelector('.schedule_table table');
        if (!table) return [];
        
        const rows = table.querySelectorAll('tbody tr');
        const result = [];
        let currentDay = '';
        const dayNames = ['пн','вт','ср','чт','пт','сб','вс'];
        
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const cells = row.querySelectorAll('td');
            if (cells.length < 4) continue;
            
            const first = cells[0];
            let dayText = first.innerText.trim().toLowerCase().replace(/[^а-я]/g, '');
            let isDay = first.classList && first.classList.contains('day-header');
            
            if (!isDay && dayText.length >= 2 && dayNames.includes(dayText.substring(0,2))) {
                isDay = true;
                dayText = dayText.substring(0,2);
            }
            if (isDay && dayText.length >= 2) { 
                currentDay = dayText.substring(0,2); 
            }
            if (!currentDay) continue;
            
            const timeCell = cells[1];
            let timeText = '';
            const timeDiv = timeCell.querySelector('.time');
            
            if (timeDiv) timeText = timeDiv.innerText.trim();
            if (!timeText) {
                const ext = timeCell.querySelector('.extend_time');
                if (ext) timeText = ext.innerText.trim().split('--')[0];
            }
            
            const startTime = this._normalizeTime(timeText);
            if (!startTime) continue;
            
            const lesson1 = this._parseLesson(cells[2]);
            const lesson2 = this._parseLesson(cells[3]);
            
            if (lesson1 && lesson1.name && lesson1.name.length >= 2) {
                result.push({ day: currentDay, time: startTime, week: 1, ...lesson1 });
            }
            if (lesson2 && lesson2.name && lesson2.name.length >= 2) {
                result.push({ day: currentDay, time: startTime, week: 2, ...lesson2 });
            }
        }
        return result;
    },
    
    _normalizeTime(str) {
        if (!str) return '';
        const m = str.match(/(\d{1,2}):(\d{2})/);
        if (!m) return '';
        let h = parseInt(m[1], 10) % 24;
        let min = parseInt(m[2], 10) % 60;
        return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
    },
    
    _parseLesson(cell) {
        if (!cell) return null;
        const html = cell.innerHTML.trim();
        if (!html || html === '&nbsp;') return null;
        
        let name = '';
        const main = cell.querySelector('.mainScheduleInfo');
        
        if (main) {
            let text = main.innerText.trim();
            let parts = text.split(',');
            name = parts[0].trim();
            if (name.includes(' - ')) name = name.split(' - ')[0].trim();
        } else {
            const short = cell.querySelector('.ShortScheduleInfo');
            if (short) {
                let text = short.innerText.trim();
                let parts = text.split(',');
                name = parts[0].trim();
                if (name.includes(' - ')) name = name.split(' - ')[0].trim();
            }
        }
        
        if (!name || name.length < 2) return null;
        
        let type = '';
        const typeDiv = cell.querySelector('.small.text-muted');
        if (typeDiv) type = typeDiv.innerText.trim();
        
        let location = '—';
        const roomLink = cell.querySelector('a[href*="/room/"]');
        
        if (roomLink) {
            let roomText = roomLink.innerText.trim();
            const parentText = roomLink.parentNode.innerText;
            const matchExtra = parentText.match(/,\s*(.+?)(?:\s*<|$)/);
            if (matchExtra && matchExtra[1].trim() !== roomText) {
                location = roomText + ' ' + matchExtra[1].trim();
            } else {
                location = roomText;
            }
        } else if (cell.innerText.includes('неизв.')) {
            location = 'неизв.';
        }
        
        return { name, type, location };
    }
};

// === APP ===
class ScheduleApp {
    constructor() {
        this.baseUrl = 'https://rasps.nsuem.ru/group/9-%D0%98%D0%A1403/';
        this.subgroup = Store.get('subgroup', '1');
        this.week = Store.get('week', 'auto');
        this.cachedData = Store.get('cachedData', null);
        this.lastUpdate = Store.get('lastUpdate', null);
        
        this.initUI();
        this.loadData(true);
        setInterval(() => this.loadData(true), 600000); // 10 мин
    }

    initUI() {
        this.updateHeaderAndMenu();

        // Бургер меню
        const burgerBtn = document.getElementById('burgerBtn');
        const overlay = document.getElementById('burgerOverlay');
        const menu = document.getElementById('burgerMenu');
        const closeBtn = document.getElementById('closeBurger');

        const open = () => {
            menu.classList.add('active');
            overlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        };
        const close = () => {
            menu.classList.remove('active');
            overlay.classList.remove('active');
            document.body.style.overflow = '';
        };

        burgerBtn.addEventListener('click', open);
        closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', close);

        // Меню подгруппы
        document.querySelectorAll('[data-action="subgroup"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const val = btn.dataset.value;
                if (val) this.changeSubgroup(val);
                close();
            });
        });

        // Меню недели
        document.querySelectorAll('[data-action="week"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const val = btn.dataset.value;
                if (val) this.setWeek(val);
                close();
            });
        });

        // Действия
        document.getElementById('menuToday').addEventListener('click', () => {
            this.scrollToToday();
            close();
        });

        document.getElementById('menuRefresh').addEventListener('click', () => {
            this.forceRefresh();
            close();
        });
    }

    updateHeaderAndMenu() {
        document.getElementById('subgroupBadge').textContent = this.subgroup;
        const weekLabel = this.week === 'auto' ? 'Авто' : this.week + ' нед.';
        document.getElementById('weekBadge').textContent = weekLabel;

        document.querySelectorAll('[data-action="subgroup"] .sub').forEach(el => el.style.display = 'none');
        document.getElementById(`menuSubgroup${this.subgroup}`).style.display = 'inline';

        document.querySelectorAll('[data-action="week"] .sub').forEach(el => el.style.display = 'none');
        if (this.week === 'auto') document.getElementById('menuWeekAuto').style.display = 'inline';
        else document.getElementById(`menuWeek${this.week}`).style.display = 'inline';
    }

    getActualWeek() {
        if (this.week !== 'auto') return parseInt(this.week, 10);
        const start = new Date(2024, 8, 1);
        const diff = Math.floor((new Date() - start) / (1000 * 60 * 60 * 24 * 7));
        return (diff % 2 === 0) ? 1 : 2;
    }

    async loadData(useCache = true) {
        const container = document.getElementById('cardsContainer');
        if (!useCache || !this.cachedData) {
            container.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
        }
        
        try {
            const url = this.baseUrl + this.subgroup;
            const res = await fetch(url);
            if (!res.ok) throw new Error('Network error');
            const html = await res.text();
            
            const data = ScheduleParser.parseSemester(html);
            if (data.length === 0) throw new Error('No data');
            
            this.cachedData = data;
            Store.set('cachedData', data);
            
            const now = new Date().toLocaleString('ru-RU');
            this.lastUpdate = now;
            Store.set('lastUpdate', now);
            
            document.getElementById('updateTime').textContent = now;
            this.render(data);
        } catch (err) {
            if (this.cachedData && useCache) {
                this.render(this.cachedData);
                document.getElementById('updateTime').textContent = 'кеш от ' + (this.lastUpdate || '');
            } else {
                container.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);"><i class="fas fa-wifi-slash" style="font-size:1.5rem;display:block;margin-bottom:0.5rem;"></i>Не удалось загрузить данные</div>`;
            }
        }
    }

    render(data) {
        const container = document.getElementById('cardsContainer');
        const targetWeek = this.getActualWeek();
        const filtered = data.filter(l => l.week === targetWeek);
        
        if (filtered.length === 0) {
            container.innerHTML = `<div style="text-align:center;padding:3rem 1rem;color:var(--text-muted); font-size: 0.9rem;">Нет пар на этой неделе</div>`;
            return;
        }

        const daysMap = new Map();
        filtered.forEach(l => {
            if (!daysMap.has(l.day)) daysMap.set(l.day, []);
            daysMap.get(l.day).push(l);
        });

        const todayShort = new Date().toLocaleDateString('ru-RU', { weekday: 'short' }).toLowerCase().slice(0, 2);
        const fullDays = { 'пн':'Понедельник','вт':'Вторник','ср':'Среда','чт':'Четверг','пт':'Пятница','сб':'Суббота','вс':'Воскресенье' };

        let html = '';
        let delay = 0;
        
        for (const [day, lessons] of daysMap) {
            const isToday = day.toLowerCase().startsWith(todayShort);
            const fullName = fullDays[day] || day.toUpperCase();
            
            html += `
                <div class="day-card ${isToday ? 'today' : ''}" style="animation-delay:${delay}s">
                    <div class="day-card__header">
                        <span class="day-name">
                            <i class="fas fa-calendar-day"></i> ${fullName}
                            ${isToday ? '<span class="today-badge">сегодня</span>' : ''}
                        </span>
                    </div>
                    <table class="lessons-table">
            `;
            
            lessons.forEach(l => {
                const isNow = isToday && this.isCurrentLesson(l.time);
                const endTime = this.addMinutes(l.time, 90);
                const roomHtml = this.formatRoom(l.location);
                const lessonName = this.escapeHtml(l.name || '');
                const lessonType = this.escapeHtml(l.type || '');

                html += `
                    <tr class="${isNow ? 'current-lesson' : ''}">
                        <td class="time-col">${this.escapeHtml(l.time)}<br><span style="font-size:0.7em; color:var(--text-muted)">${endTime}</span></td>
                        <td>
                            <div class="lesson-info">
                                <div class="lesson-name">${lessonName}</div>
                                <div class="lesson-meta">
                                    ${lessonType ? `<span class="lesson-type">${lessonType}</span>` : ''}
                                    <span><i class="fas fa-location-dot"></i> ${roomHtml}</span>
                                    ${isNow ? '<span class="now-indicator"></span>' : ''}
                                </div>
                            </div>
                        </td>
                    </tr>
                `;
            });
            html += `</table></div>`;
            delay += 0.05;
        }
        container.innerHTML = html;
    }

    isCurrentLesson(startTime) {
        if (!startTime) return false;
        const [h, m] = startTime.split(':').map(Number);
        const now = new Date();
        const start = h * 60 + m;
        const current = now.getHours() * 60 + now.getMinutes();
        return current >= start && current < start + 95;
    }

    addMinutes(time, mins) {
        if (!time) return '--:--';
        const [h, m] = time.split(':').map(Number);
        const total = h * 60 + m + mins;
        const nh = Math.floor(total / 60) % 24;
        const nm = total % 60;
        return `${String(nh).padStart(2,'0')}:${String(nm).padStart(2,'0')}`;
    }

    formatRoom(loc) { return (!loc || loc === '—') ? '—' : loc; }
    escapeHtml(str) { if (!str) return ''; return str.replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[m] || m); }

    changeSubgroup(val) {
        if (this.subgroup === val) return;
        this.subgroup = val;
        Store.set('subgroup', val);
        this.updateHeaderAndMenu();
        this.loadData(false);
    }

    setWeek(val) {
        if (this.week === val) return;
        this.week = val;
        Store.set('week', val);
        this.updateHeaderAndMenu();
        if (this.cachedData) this.render(this.cachedData);
        else this.loadData(true);
    }

    forceRefresh() {
        this.loadData(false);
    }

    scrollToToday() {
        const el = document.querySelector('.day-card.today');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        else alert('Сегодня пар нет.');
    }
}

// === PWA POPUP ===
function showPwaPopupOnce() {
    if (localStorage.getItem('pwa_popup_shown') === 'true') return;

    const popup = document.createElement('div');
    popup.id = 'pwa-popup';
    popup.innerHTML = `
        <p style="margin: 0 0 10px 0; font-weight: 600; text-align: center; font-size: 14px; letter-spacing: 0.3px;">📱 Установи приложение</p>
        <p style="margin: 0 0 8px 0; line-height: 1.4; color: var(--text-secondary);">🍏 <b>iPhone:</b> «Поделиться» → «На экран "Домой"»</p>
        <p style="margin: 0 0 14px 0; line-height: 1.4; color: var(--text-secondary);">🤖 <b>Android:</b> Три точки → «Установить»</p>
        <div class="pwa-timeline"></div>
    `;

    document.body.appendChild(popup);

    setTimeout(() => {
        popup.classList.add('show');
        localStorage.setItem('pwa_popup_shown', 'true');
    }, 1000);

    setTimeout(() => {
        popup.classList.remove('show');
        setTimeout(() => popup.remove(), 400);
    }, 6000);
}

// === ИНИЦИАЛИЗАЦИЯ ===
window.addEventListener('DOMContentLoaded', () => {
    // Запуск приложения расписания
    window.app = new ScheduleApp();
    
    // Показ попапа
    showPwaPopupOnce();
    
    // GoatCounter трекер кликов
    const checkGoat = setInterval(() => {
        if (window.goatcounter && window.goatcounter.count) {
            clearInterval(checkGoat);
            
            const trackButtonClick = (buttonText, eventPath, eventTitle) => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const targetButton = buttons.find(btn => btn.textContent.includes(buttonText));
                if (targetButton) {
                    targetButton.addEventListener('click', () => {
                        window.goatcounter.count({
                            path: eventPath,
                            title: eventTitle,
                            event: true
                        });
                    });
                }
            };

            trackButtonClick('Подгруппа 1', 'click-subgroup-1', 'Выбор Подгруппы 1');
            trackButtonClick('Подгруппа 2', 'click-subgroup-2', 'Выбор Подгруппы 2');
            trackButtonClick('1 неделя', 'click-week-1', 'Просмотр 1 недели');
            trackButtonClick('2 неделя', 'click-week-2', 'Просмотр 2 недели');
            trackButtonClick('Сегодня', 'click-today', 'Клик по кнопке Сегодня');
            trackButtonClick('Обновить', 'click-refresh', 'Ручное обновление расписания');
        }
    }, 100);
});

// Регистрация Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(() => console.log('Service Worker (PWA) активен'))
            .catch(err => console.log('Ошибка регистрации SW:', err));
    });
}