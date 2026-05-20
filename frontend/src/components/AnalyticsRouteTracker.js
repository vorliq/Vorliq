import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { featureEventForRoute, routeCategory, sendAnalyticsEvent } from "../helpers/analytics";

function AnalyticsRouteTracker() {
  const location = useLocation();

  useEffect(() => {
    const category = routeCategory(location.pathname);
    sendAnalyticsEvent("page_view", {
      route: location.pathname,
      category,
      metadata: { route_category: category },
    });

    const featureEvent = featureEventForRoute(location.pathname);
    if (featureEvent) {
      sendAnalyticsEvent(featureEvent, {
        route: location.pathname,
        category,
        metadata: { feature: featureEvent.replace("_page_opened", "") },
      });
    }
  }, [location.pathname]);

  return null;
}

export default AnalyticsRouteTracker;
