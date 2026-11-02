import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import Button from '../../../../components/common/Button/Button';
import styles from './RecordCalendar.module.css';

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const VIEWS = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
];

function RecordCalendar({ records, objectMeta, objectApiName, fields = [] }) {
  const navigate = useNavigate();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState('month');

  const calendarConfig = objectMeta?.calendarConfig;
  if (!calendarConfig?.enabled || !calendarConfig?.dateFieldApiName) return null;

  const dateFieldApiName = calendarConfig.dateFieldApiName;
  const titleFieldApiName = calendarConfig.titleFieldApiName || objectMeta.nameFieldApiName || 'name';

  const getEventTitle = (record) => {
    const data = record.data || {};
    if (data instanceof Map) {
      return data.get(titleFieldApiName) || data.get('name') || record.recordName || `${objectMeta.label} Record`;
    }
    return data[titleFieldApiName] || data.name || record.recordName || `${objectMeta.label} Record`;
  };

  const getEventDate = (record) => {
    const data = record.data || {};
    const val = data instanceof Map ? data.get(dateFieldApiName) : data[dateFieldApiName];
    if (!val) return null;
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  };

  const eventsForDate = (date) => {
    return records.filter((r) => {
      const eventDate = getEventDate(r);
      if (!eventDate) return false;
      return (
        eventDate.getFullYear() === date.getFullYear() &&
        eventDate.getMonth() === date.getMonth() &&
        eventDate.getDate() === date.getDate()
      );
    });
  };

  const handlePrevious = () => {
    const d = new Date(currentDate);
    if (view === 'month') d.setMonth(d.getMonth() - 1);
    else if (view === 'week') d.setDate(d.getDate() - 7);
    else d.setDate(d.getDate() - 1);
    setCurrentDate(d);
  };

  const handleNext = () => {
    const d = new Date(currentDate);
    if (view === 'month') d.setMonth(d.getMonth() + 1);
    else if (view === 'week') d.setDate(d.getDate() + 7);
    else d.setDate(d.getDate() + 1);
    setCurrentDate(d);
  };

  const handleToday = () => setCurrentDate(new Date());

  const handleRecordClick = (record) => {
    navigate(`/o/${objectApiName}/${record._id}`);
  };

  const monthCalendar = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());
    const calendar = [];
    let currentWeek = [];
    for (let i = 0; i < 42; i++) {
      currentWeek.push(new Date(startDate));
      if (currentWeek.length === 7) {
        calendar.push(currentWeek);
        currentWeek = [];
      }
      startDate.setDate(startDate.getDate() + 1);
    }
    return calendar;
  }, [currentDate]);

  const weekStart = useMemo(() => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() - d.getDay());
    return d;
  }, [currentDate]);

  const weekDays = useMemo(() => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      days.push(new Date(weekStart.getTime() + i * 86400000));
    }
    return days;
  }, [weekStart]);

  const renderHeader = (titleText) => (
    <div className={styles.calendarHeader}>
      <button className={styles.navBtn} onClick={handlePrevious}>
        <ChevronLeft size={20} />
      </button>
      <div className={styles.dateDisplay}>
        <h2>{titleText}</h2>
      </div>
      <button className={styles.navBtn} onClick={handleNext}>
        <ChevronRight size={20} />
      </button>
      <Button size="sm" variant="secondary" onClick={handleToday}>Today</Button>
      <div className={styles.controls}>
        {VIEWS.map((v) => (
          <button
            key={v.value}
            className={`${styles.viewBtn} ${view === v.value ? styles.viewBtnActive : ''}`}
            onClick={() => setView(v.value)}
          >
            {v.label}
          </button>
        ))}
      </div>
    </div>
  );

  if (view === 'month') {
    return (
      <div className={styles.calendarContainer}>
        {renderHeader(`${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`)}
        <div className={styles.weekdayRow}>
          {DAYS_OF_WEEK.map((d) => (
            <div key={d} className={styles.weekdayHeader}>{d}</div>
          ))}
        </div>
        {monthCalendar.map((week, wi) => (
          <div key={wi} className={styles.week}>
            {week.map((date) => {
              const dayEvents = eventsForDate(date);
              const isCurrentMonth = date.getMonth() === currentDate.getMonth();
              const isToday = date.toDateString() === new Date().toDateString();
              return (
                <div
                  key={date.toISOString()}
                  className={`${styles.day} ${!isCurrentMonth ? styles.dayOtherMonth : ''} ${isToday ? styles.dayToday : ''}`}
                  onClick={() => { setView('day'); setCurrentDate(date); }}
                >
                  <div className={styles.dayNumber}>{date.getDate()}</div>
                  <div className={styles.dayEvents}>
                    {dayEvents.slice(0, 2).map((r) => (
                      <div
                        key={r._id}
                        className={styles.eventBadge}
                        onClick={(e) => { e.stopPropagation(); handleRecordClick(r); }}
                        title={getEventTitle(r)}
                      >
                        {getEventTitle(r)}
                      </div>
                    ))}
                    {dayEvents.length > 2 && (
                      <div className={styles.moreCount}>+{dayEvents.length - 2} more</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  if (view === 'week') {
    return (
      <div className={styles.calendarContainer}>
        {renderHeader(
          `${weekStart.toLocaleDateString('en-ZA')} – ${new Date(weekStart.getTime() + 6 * 86400000).toLocaleDateString('en-ZA')}`
        )}
        <div className={styles.weekViewContainer}>
          {weekDays.map((date) => {
            const dayEvents = eventsForDate(date);
            const isToday = date.toDateString() === new Date().toDateString();
            return (
              <div key={date.toISOString()} className={`${styles.weekDay} ${isToday ? styles.dayToday : ''}`}>
                <div className={styles.weekDayHeader}>
                  <div className={styles.weekDayName}>{DAYS_OF_WEEK[date.getDay()]}</div>
                  <div className={styles.weekDayDate}>{date.getDate()}</div>
                </div>
                <div className={styles.weekDayEvents}>
                  {dayEvents.map((r) => (
                    <div
                      key={r._id}
                      className={styles.weekEventItem}
                      onClick={() => handleRecordClick(r)}
                    >
                      <span className={styles.weekEventTitle}>{getEventTitle(r)}</span>
                    </div>
                  ))}
                  {dayEvents.length === 0 && <div className={styles.noEvents}>No events</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Day view
  const dayEvents = eventsForDate(currentDate);
  return (
    <div className={styles.calendarContainer}>
      {renderHeader(
        currentDate.toLocaleDateString('en-ZA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
      )}
      <div className={styles.dayViewContainer}>
        {dayEvents.length > 0 ? (
          <div className={styles.dayEventList}>
            {dayEvents.map((r) => (
              <div key={r._id} className={styles.dayEventItem} onClick={() => handleRecordClick(r)}>
                <div>
                  <div className={styles.dayEventTitle}>{getEventTitle(r)}</div>
                  <div className={styles.dayEventMeta}>
                    {getEventDate(r)?.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <Calendar size={48} />
            <p>No events for this day</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default RecordCalendar;
