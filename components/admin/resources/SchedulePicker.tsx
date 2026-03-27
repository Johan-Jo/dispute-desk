"use client";

import { useState } from "react";
import { Calendar, Info, X } from "lucide-react";

interface SchedulePickerProps {
  onClose: () => void;
  onSchedule: (date: string, time: string) => void;
}

export function SchedulePicker({ onClose, onSchedule }: SchedulePickerProps) {
  const [selectedDate, setSelectedDate] = useState(
    new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  );
  const [selectedTime, setSelectedTime] = useState("09:00");

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="p-6 border-b border-[#E1E3E5]">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-[#0B1220]">Schedule Publishing</h3>
            <button onClick={onClose} className="p-1 text-[#667085] hover:text-[#0B1220]">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="text-sm font-medium text-[#0B1220] mb-2 block">Publish Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full px-4 py-2.5 border border-[#E1E3E5] rounded-lg text-sm text-[#0B1220] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-[#0B1220] mb-2 block">
              Publish Time (UTC)
            </label>
            <input
              type="time"
              value={selectedTime}
              onChange={(e) => setSelectedTime(e.target.value)}
              className="w-full px-4 py-2.5 border border-[#E1E3E5] rounded-lg text-sm text-[#0B1220] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
            />
          </div>

          <div className="p-3 bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-[#1D4ED8] flex-shrink-0 mt-0.5" />
              <div className="text-xs text-[#1D4ED8]">
                Content will be automatically published at{" "}
                <span className="font-semibold">
                  {selectedDate} {selectedTime} UTC
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-[#E1E3E5] flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-[#667085] hover:text-[#0B1220]"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSchedule(selectedDate, selectedTime);
              onClose();
            }}
            className="px-4 py-2 bg-[#1D4ED8] text-white text-sm font-medium rounded-lg hover:bg-[#1e40af] flex items-center gap-2"
          >
            <Calendar className="w-4 h-4" />
            Schedule
          </button>
        </div>
      </div>
    </div>
  );
}
