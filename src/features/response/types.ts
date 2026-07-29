export interface ScheduleEntry {
  time: string;
  label: string;
}

export interface ScheduleResponseContent {
  type: "schedule";
  title: string;
  entries: ScheduleEntry[];
}

export interface TextResponseContent {
  type: "text";
  text: string;
}

export type ResponseContent = ScheduleResponseContent | TextResponseContent;
