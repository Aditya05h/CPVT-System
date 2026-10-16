export type VehicleType = "two_wheeler" | "four_wheeler";
export interface ParkingRecord {
  id: string;
  vehicleNumber: string;
  vehicleType: VehicleType;
  ownerCategory: "Staff" | "Student" | "Visitor";
  slotId: string;
  entryHour: number;
  exitHour: number | null;
  checkedInAt: string;
  checkedOutAt: string | null;
  status: "Parked" | "Completed";
  duration: number | null;
  fee: number | null;
  calculation: {
    freeHours: number;
    billableHours: number;
    ratePerHour: number;
  } | null;
}
export interface Slot {
  id: string;
  vehicleType: VehicleType;
  ordinal: number;
  status: "Available" | "Occupied" | "Reserved";
  record: ParkingRecord | null;
  reservation: { slotId: string; vehicleNumber: string; note: string; reservedAt: string } | null;
}
export interface Reservation { slotId: string; vehicleNumber: string; note: string; status: "Reserved" | "Available"; reservedAt?: string }
export interface Snapshot {
  zones: {
    vehicleType: VehicleType;
    total: number;
    occupied: number;
    vacant: number;
  }[];
  date: string;
  timezone: string;
  slots: Slot[];
  records: ParkingRecord[];
  summary: {
    vehiclesParked: number;
    completedCheckouts: number;
    feesAssessed: number;
  };
}
export interface Envelope<T> {
  data: T;
  meta?: { mode: "local" | "supabase" };
}
