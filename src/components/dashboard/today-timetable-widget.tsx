"use client";

import { useState } from "react";
import { Plus, Clock, MapPin, Calendar as CalendarIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAppStore } from "@/store/app-store";

// Dummy data for now. Real implementation would fetch from Supabase.
const DUMMY_TIMETABLE = [
  { id: 1, name: "고급웹프로그래밍", time: "09:00 - 10:30", room: "공학관 201호", color: "bg-blue-100 text-blue-700" },
  { id: 2, name: "데이터베이스", time: "11:00 - 12:15", room: "정보관 304호", color: "bg-emerald-100 text-emerald-700" },
];

export function TodayTimetableWidget() {
  const { isTimetableModalOpen, setIsTimetableModalOpen, timetableItems } = useAppStore();

  return (
    <>
      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm relative overflow-hidden group">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CalendarIcon size={18} strokeWidth={2.5} />
            </div>
            <div>
              <h3 className="font-bold text-gray-800 text-[15px]">오늘의 시간표</h3>
              <p className="text-[11px] text-gray-400">수요일</p>
            </div>
          </div>
          <button 
            onClick={() => setIsTimetableModalOpen(true)}
            className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center text-gray-600 hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
          >
            <Plus size={18} />
          </button>
        </div>

        {timetableItems.length === 0 ? (
          <div className="text-center py-6 bg-gray-50 rounded-xl border border-dashed border-gray-200">
            <p className="text-sm text-gray-500 font-medium">오늘 등록된 수업이 없습니다</p>
            <p className="text-[11px] text-gray-400 mt-1">+ 버튼을 눌러 일정을 추가해보세요</p>
          </div>
        ) : (
          <div className="space-y-3">
            {timetableItems.map((course) => (
              <div key={course.id} className="flex items-center gap-3">
                <div className="w-1.5 h-10 rounded-full bg-emerald-400" />
                <div className={`flex-1 rounded-xl p-3 flex justify-between items-center ${course.color}`}>
                  <div>
                    <div className="font-bold text-[13px] leading-tight mb-1">{course.name}</div>
                    <div className="flex items-center gap-2 text-[10px] font-medium opacity-80">
                      <span className="flex items-center gap-0.5"><Clock size={10} />{course.time}</span>
                      <span className="flex items-center gap-0.5"><MapPin size={10} />{course.room}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Timetable Add Modal */}
      <AnimatePresence>
        {isTimetableModalOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsTimetableModalOpen(false)}
              className="fixed inset-0 bg-black z-[110]"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-4 right-4 md:left-1/2 md:-translate-x-1/2 md:w-[400px] bottom-10 md:bottom-auto md:top-1/2 md:-translate-y-1/2 bg-white rounded-3xl p-6 z-[120] shadow-2xl"
            >
              <h3 className="text-lg font-bold text-gray-800 mb-2">시간표 추가</h3>
              <p className="text-xs text-gray-500 mb-6">수업이나 일정을 추가하세요.</p>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-[11px] font-bold text-gray-600 mb-1.5 uppercase">과목/일정명</label>
                  <input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30" placeholder="예: 시스템프로그래밍" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-gray-600 mb-1.5 uppercase">시작 시간</label>
                    <input type="time" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30" defaultValue="09:00" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-600 mb-1.5 uppercase">종료 시간</label>
                    <input type="time" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30" defaultValue="10:30" />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-gray-600 mb-1.5 uppercase">장소</label>
                  <input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30" placeholder="예: 정보관 201호" />
                </div>
              </div>

              <div className="flex gap-3 mt-8">
                <button 
                  onClick={() => setIsTimetableModalOpen(false)}
                  className="flex-1 py-3.5 rounded-xl font-semibold text-gray-500 bg-gray-100 hover:bg-gray-200 transition-colors"
                >
                  취소
                </button>
                <button 
                  onClick={() => setIsTimetableModalOpen(false)}
                  className="flex-1 py-3.5 rounded-xl font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors"
                >
                  추가하기
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
