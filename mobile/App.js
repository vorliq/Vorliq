import React from "react";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import HomeScreen from "./src/screens/HomeScreen";
import WalletScreen from "./src/screens/WalletScreen";
import SendScreen from "./src/screens/SendScreen";
import LendingScreen from "./src/screens/LendingScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import theme from "./src/theme";

const Tab = createBottomTabNavigator();

function TabIcon({ name, color }) {
  const common = {
    fill: "none",
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };

  if (name === "Home") {
    return (
      <Svg width={24} height={24} viewBox="0 0 24 24">
        <Path {...common} d="M3 11.5 12 4l9 7.5" />
        <Path {...common} d="M5.5 10.5V20h13v-9.5" />
        <Path {...common} d="M9.5 20v-5h5v5" />
      </Svg>
    );
  }

  if (name === "Wallet") {
    return (
      <Svg width={24} height={24} viewBox="0 0 24 24">
        <Rect {...common} x={3} y={6} width={18} height={13} rx={3} />
        <Path {...common} d="M16 12h4" />
        <Circle cx={16.5} cy={12} r={1} fill={color} />
      </Svg>
    );
  }

  if (name === "Send") {
    return (
      <Svg width={24} height={24} viewBox="0 0 24 24">
        <Path {...common} d="M4 12h15" />
        <Path {...common} d="m13 6 6 6-6 6" />
      </Svg>
    );
  }

  if (name === "Lending") {
    return (
      <Svg width={24} height={24} viewBox="0 0 24 24">
        <Path {...common} d="M4 15c3-3 5-3 8 0s5 3 8 0" />
        <Path {...common} d="M6 9h12" />
        <Path {...common} d="M8 5h8" />
        <Path {...common} d="M12 5v14" />
      </Svg>
    );
  }

  return (
    <Svg width={24} height={24} viewBox="0 0 24 24">
      <Circle {...common} cx={12} cy={12} r={3} />
      <Path {...common} d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" />
    </Svg>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="light" />
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarIcon: ({ color }) => <TabIcon name={route.name} color={color} />,
            tabBarActiveTintColor: theme.accent,
            tabBarInactiveTintColor: theme.textSecondary,
            tabBarStyle: {
              backgroundColor: theme.card,
              borderTopColor: theme.border,
              minHeight: 64,
              paddingBottom: 8,
              paddingTop: 8,
            },
            tabBarLabelStyle: {
              fontSize: theme.fonts.small,
              fontWeight: "700",
            },
          })}
        >
          <Tab.Screen name="Home" component={HomeScreen} />
          <Tab.Screen name="Wallet" component={WalletScreen} />
          <Tab.Screen name="Send" component={SendScreen} />
          <Tab.Screen name="Lending" component={LendingScreen} />
          <Tab.Screen name="Settings" component={SettingsScreen} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
