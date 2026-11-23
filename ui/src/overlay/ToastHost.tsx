import { useToast } from "@/overlay/toast";

export function ToastHost() {
  const message = useToast((state) => state.message);
  if (!message) {
    return null;
  }
  return <div className="toast">{message}</div>;
}
