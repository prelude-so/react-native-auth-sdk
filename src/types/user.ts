import { PreludeProfile, PreludeProfileJson, profileFromJson } from "./profile";

/** Authenticated user returned from login and refresh flows. */
export interface PreludeUser {
  accessToken: string;
  profile: PreludeProfile;
}

export interface PreludeUserJson {
  accessToken: string;
  profile: PreludeProfileJson;
}

export function userFromJson(json: PreludeUserJson): PreludeUser {
  return {
    accessToken: json.accessToken,
    profile: profileFromJson(json.profile),
  };
}
