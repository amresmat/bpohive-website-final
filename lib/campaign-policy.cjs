const minimum=4000;
const budgetLabels={
 '4000_6999':'$4,000–$6,999',
 '7000_9999':'$7,000–$9,999',
 '10000_plus':'$10,000+',
 'under_4000':'Below $4,000 — request an individual review',
 'not_sure':'Not sure — help me assess the investment'
};
const qualifiedBudget=value=>['4000_6999','7000_9999','10000_plus'].includes(value);
const introduction='Build a sales process you can scale.';
const scope='We help define your ideal customer profile, research your audience, develop your outreach strategy, qualify interested prospects and book meetings directly on your calendar.';
const portal='You get a dedicated client portal with real-time visibility into campaign activity, progress and booked meetings. Your team can listen to qualified conversations and understand each prospect’s needs and concerns before the sales call.';
const insights='Our reporting shows how your audience responds, which objections come up most often and where opportunities exist. Together, we use those insights to refine your strategy, improve your sales process and decide what to scale.';
const minimumCopy='The full managed service starts at $4,000 per month. This is the starting investment for the research, strategy, outreach and ongoing support described here.';
const exceptionCopy='Budgets below $4,000 are considered only for a smaller scope, on a case-by-case basis. Acceptance is limited and subject to review; submitting a request does not confirm an engagement or release a booking slot.';
module.exports={minimum,budgetLabels,qualifiedBudget,introduction,scope,portal,insights,minimumCopy,exceptionCopy};
