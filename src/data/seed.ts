// Placeholder content. Replace with real sources (contacts, modem, library…).

export interface Contact {
  name: string
  number: string
}

export interface Message {
  text: string
  me: boolean
}

export interface Thread {
  name: string
  when: string
  msgs: Message[]
}

export interface Note {
  text: string
  when: string
}

export interface Article {
  title: string
  source: string
  minutes: number | null
  progress?: number
}

export const contacts: Contact[] = [
  { name: 'Ana', number: '+34 600 000 000' },
  { name: 'Martín', number: '+54 9 11 0000 0000' },
  { name: 'Lucía', number: '+34 611 000 000' },
]

export const threads: Thread[] = [
  {
    name: 'Ana',
    when: '21:40',
    msgs: [
      { text: 'Are we still on for coffee tomorrow?', me: false },
      { text: 'Yes, 10:30 at the usual place.', me: true },
      { text: 'Perfect, see you there.', me: false },
    ],
  },
  { name: 'Martín', when: 'yesterday', msgs: [{ text: 'Sent you the photos from the weekend.', me: false }] },
  {
    name: 'Lucía',
    when: 'mon',
    msgs: [
      { text: 'Call me when you have a minute.', me: false },
      { text: 'Will do tonight.', me: true },
    ],
  },
]

export const notes: Note[] = [
  { text: 'Buy coffee beans before Saturday.', when: 'today' },
  { text: 'Shell idea: swipe down = back, nothing else.', when: 'yesterday' },
  { text: 'Ask about the workshop space in Gràcia.', when: 'mon' },
]

export const articles: Article[] = [
  { title: 'Local-first software', source: 'inkandswitch.com', minutes: 34, progress: 0.64 },
  { title: 'Malleable software', source: 'inkandswitch.com', minutes: 28 },
  { title: '[Latest post]', source: 'The Open Inner Monologue', minutes: null },
]
