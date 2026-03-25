# FFU Analyzer

#Live at: https://zooming-embrace-production.up.railway.app/

## What i built

I implemented structured outputs for the analyzer. This forces the LLM to respond with a specific JSON format. Right now it includes the main response, a list of dates mentioned in the text, and a list of risks mentioned in the text.

## Why i built it

The output from the LLM was unstructed text, which made it difficult to see the most important things. By implementing structured outputs, i can easily extract the most important information and present it in a more user-friendly way. It is barebones right now, but it is a good starting point for further development.

## What i would to next

I would add better structure for the JSON format. For example, the risks could be categorized into different types of risks, and the dates could be categorized into different types of dates e.g. deadlines, events, etc. I would also add more information to the JSON format, such as the severity of the risks and the importance of the dates.
<br><br>
I would also like to build a better frontend to display the output from the LLM. Right now it's just simple lists. There could be a more visual way to display the risks and dates, such as a timeline for the dates. Or maybe a chart for the risks.
