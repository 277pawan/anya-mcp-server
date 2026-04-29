export async function findEmailWithHunter(domain, name, apiKey) {
  const [firstName, lastName] = name?.split(" ") || [];
  let url = `https://api.hunter.io/v2/domain-search?domain=${domain}&api_key=${apiKey}`;
  if (firstName) url += `&first_name=${firstName}`;
  if (lastName) url += `&last_name=${lastName}`;

  const response = await fetch(url);
  return await response.json();
}
