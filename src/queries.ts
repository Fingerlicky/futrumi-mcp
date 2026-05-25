// GraphQL query strings. Field selections kept tight on purpose — anything
// included here lands in the LLM context, so the cheaper the better.

export const RECOMMENDATIONS_QUERY = /* GraphQL */ `
  query Recommendations($filter: RecommendationFilterInput!, $pagination: PaginationInput!) {
    recommendations(filter: $filter, pagination: $pagination) {
      total
      edges {
        id
        description
        strongQuote
        publishDate
        distance
        expert {
          id
          name
          photoUrl {
            url
          }
        }
        business {
          id
          name
          address
          location {
            latitude
            longitude
          }
          primaryBusinessType {
            id
            name
          }
          openingHours
        }
        meals {
          id
          name
        }
      }
    }
  }
`;

export const RECOMMENDED_BUSINESSES_QUERY = /* GraphQL */ `
  query RecommendedBusinesses(
    $filter: BusinessFilterInput!
    $location: LocationInput
    $pagination: PaginationInput!
  ) {
    recommendedBusinesses(filter: $filter, location: $location, pagination: $pagination) {
      total
      edges {
        id
        name
        address
        bio
        distance
        location {
          latitude
          longitude
        }
        primaryBusinessType {
          id
          name
        }
        openingHours
        expertsWithRecommendationCount
        photoUrl {
          url
        }
      }
    }
  }
`;

export const RECOMMENDATION_QUERY = /* GraphQL */ `
  query Recommendation($id: String!) {
    recommendation(id: $id) {
      id
      description
      strongQuote
      publishDate
      expert {
        id
        name
        photoUrl {
          url
        }
      }
      business {
        id
        name
        address
        location {
          latitude
          longitude
        }
        primaryBusinessType {
          id
          name
        }
        openingHours
      }
      meals {
        id
        name
        description
      }
    }
  }
`;

export const BUSINESS_QUERY = /* GraphQL */ `
  query Business($id: String!, $location: LocationInput) {
    business(id: $id, location: $location) {
      id
      name
      address
      bio
      distance
      location {
        latitude
        longitude
      }
      primaryBusinessType {
        id
        name
      }
      secondaryBusinessTypes {
        id
        name
      }
      openingHours
      expertsWithRecommendationCount
      photoUrl {
        url
      }
      webUrl
      menuUrl
      phoneNumber
      googleMapsUrl
      instagramUrl
      facebookUrl
      featuredQuotes {
        text
        expertPhotoUrl
      }
      recommendations {
        id
        description
        strongQuote
        publishDate
        expert {
          id
          name
          photoUrl {
            url
          }
        }
        meals {
          id
          name
          description
        }
      }
    }
  }
`;

export const EXPERT_QUERY = /* GraphQL */ `
  query Expert($id: String!) {
    expert(id: $id) {
      id
      name
      bio
      photoUrl {
        url
      }
      recommendationCount
    }
  }
`;

export const EXPERTS_QUERY = /* GraphQL */ `
  query Experts($pagination: PaginationInput!) {
    experts(pagination: $pagination) {
      total
      edges {
        id
        name
        bio
        recommendationCount
        photoUrl {
          url
        }
      }
    }
  }
`;
