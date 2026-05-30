import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.deepakdarak.moneymanager",
  appName: "Money Manager",
  webDir: "dist",
  backgroundColor: "#0d0f14",
  ios: {
    contentInset: "automatic"
  }
};

export default config;
