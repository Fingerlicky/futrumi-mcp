// Hand-typed response shapes for the subset of fields each query selects.
// Source schema: futrumi-backend/api/app/schema.gql

export interface Location {
  latitude: number;
  longitude: number;
}

export interface BusinessTypeRef {
  id: string;
  name: string;
}

export interface ExpertRef {
  id: string;
  name: string;
  photoUrl: { url: string } | null;
}

export interface BusinessRef {
  id: string;
  name: string;
  address: string;
  location: Location | null;
  primaryBusinessType: BusinessTypeRef;
  openingHours: string;
}

export interface MealRef {
  id: string;
  name: string;
}

export interface RecommendationListItem {
  id: string;
  description: string;
  strongQuote: string | null;
  publishDate: string | null;
  distance: number;
  expert: ExpertRef;
  business: BusinessRef;
  meals: MealRef[];
}

export interface BusinessListItem {
  id: string;
  name: string;
  address: string;
  bio: string | null;
  distance: number;
  location: Location | null;
  primaryBusinessType: BusinessTypeRef;
  openingHours: string;
  expertsWithRecommendationCount: number;
  photoUrl: { url: string } | null;
}

export interface FeaturedQuote {
  text: string;
  expertPhotoUrl: string | null;
}

export interface BusinessDetail extends BusinessListItem {
  webUrl: string | null;
  menuUrl: string | null;
  phoneNumber: string | null;
  googleMapsUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  secondaryBusinessTypes: BusinessTypeRef[];
  featuredQuotes: FeaturedQuote[];
  recommendations: NestedRecommendation[];
}

export interface NestedRecommendation {
  id: string;
  description: string;
  strongQuote: string | null;
  publishDate: string | null;
  expert: ExpertRef;
  meals: { id: string; name: string; description: string }[];
}

export interface RecommendationDetail {
  id: string;
  description: string;
  strongQuote: string | null;
  publishDate: string | null;
  expert: ExpertRef;
  business: BusinessRef;
  meals: { id: string; name: string; description: string }[];
}

export interface ExpertDetail {
  id: string;
  name: string;
  bio: string | null;
  photoUrl: { url: string } | null;
  recommendationCount: number;
}

export interface ExpertListItem {
  id: string;
  name: string;
  bio: string | null;
  recommendationCount: number;
  photoUrl: { url: string } | null;
}
